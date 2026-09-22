import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { removeBill, removeIncomeSource, saveBill, saveIncomeSource, saveSplit } from "./actions";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

let rpc: ReturnType<typeof vi.fn>;
let table: Record<string, ReturnType<typeof vi.fn>>;

function given({ admin = true, error = null }: { admin?: boolean; error?: { message: string } | null } = {}) {
  const eq = vi.fn().mockResolvedValue({ error });
  table = {
    insert: vi.fn().mockResolvedValue({ error }),
    update: vi.fn(() => ({ eq })),
    delete: vi.fn(() => ({ eq })),
    eq,
  };
  rpc = vi.fn(async (fn: string) =>
    fn === "has_permission" ? { data: admin, error: null } : { data: "year-id", error },
  );
  vi.mocked(createClient).mockResolvedValue({
    rpc,
    from: vi.fn(() => table),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => vi.clearAllMocks());

describe("saveSplit (REQ-50, #131)", () => {
  const split = {
    effectiveFrom: "2026-10",
    "share:u-alex": "60",
    "share:u-sam": "40",
    note: " Both salaries as of March ",
  };

  it("saves the month it starts, each person's percentage and the note in one call", async () => {
    given();
    expect(await saveSplit({}, form(split))).toEqual({
      saved: true,
      message: "Split saved, from October 2026 onwards.",
    });
    expect(rpc).toHaveBeenCalledWith("save_split", {
      p_effective_from: "2026-10-01",
      p_note: "Both salaries as of March",
      p_shares: [
        { user_id: "u-alex", percent: 60 },
        { user_id: "u-sam", percent: 40 },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/finances", "layout");
  });

  it("refuses percentages that don't total 100, before asking the database", async () => {
    given();
    const result = await saveSplit({}, form({ ...split, "share:u-sam": "30" }));
    expect(result).toEqual({ error: "The percentages add up to 90%. They must total 100%." });
    expect(rpc).not.toHaveBeenCalledWith("save_split", expect.anything());
  });

  it("accepts a split with decimals that totals exactly 100", async () => {
    given();
    const result = await saveSplit({}, form({ ...split, "share:u-alex": "66.67", "share:u-sam": "33.33" }));
    expect(result).toMatchObject({ saved: true });
  });

  it.each([
    [{ effectiveFrom: "2026" }, "Choose the month the new split starts in."],
    [{ "share:u-sam": "forty" }, "Each percentage must be a number from 0 to 100, with at most two decimals."],
  ])("refuses a bad form %j", async (change, error) => {
    given();
    expect(await saveSplit({}, form({ ...split, ...change }))).toEqual({ error });
  });

  it("sends anyone without the manage_budget key back to Finances", async () => {
    given({ admin: false });
    await expect(saveSplit({}, form(split))).rejects.toThrow("REDIRECT:/finances");
  });

  it("shows the database's refusal as-is (it checks the total too)", async () => {
    given({ error: { message: "The percentages must total 100; these total 90" } });
    expect(await saveSplit({}, form(split))).toEqual({
      error: "The percentages must total 100; these total 90",
    });
  });
});

describe("saveIncomeSource (REQ-51, #131)", () => {
  const pay = {
    name: " Day job ",
    ownerId: "u-sam",
    netAmount: "$2,400.00",
    cadence: "biweekly",
    anchorDate: "2026-09-18",
  };

  it("records the name, owner, net amount per payment, cadence and anchor date", async () => {
    given();
    expect(await saveIncomeSource({}, form(pay))).toMatchObject({ saved: true });
    expect(table.insert).toHaveBeenCalledWith({
      name: "Day job",
      owner_id: "u-sam",
      net_amount: 2400,
      cadence: "biweekly",
      anchor_date: "2026-09-18",
    });
  });

  it.each([
    [{ name: " " }, "Name the source, so two jobs can be told apart."],
    [{ netAmount: "lots" }, "Enter the take-home amount of one payment, like 2400.00."],
    [{ cadence: "hourly" }, "Choose how often it's paid."],
    [{ anchorDate: "" }, "Enter the date of one real payday."],
  ])("refuses %j", async (change, error) => {
    given();
    expect(await saveIncomeSource({}, form({ ...pay, ...change }))).toEqual({ error });
    expect(table.insert).not.toHaveBeenCalled();
  });

  it("is for admins only", async () => {
    given({ admin: false });
    await expect(saveIncomeSource({}, form(pay))).rejects.toThrow("REDIRECT:/finances");
  });

  // #131: a change starts a new source today rather than rewriting the
  // old one, so paydays already past keep the amount they were paid at.
  it("changing one ends it today and starts a new one", async () => {
    given();
    const result = await saveIncomeSource({}, form({ ...pay, id: "i-1", netAmount: "2600" }));
    expect(result).toEqual({
      saved: true,
      message: "Changed, from today onwards. Past paydays keep the old amount.",
    });
    expect(rpc).toHaveBeenCalledWith("change_income_source", {
      p_id: "i-1",
      p_name: "Day job",
      p_owner_id: "u-sam",
      p_net_amount: 2600,
      p_cadence: "biweekly",
      p_anchor_date: "2026-09-18",
    });
    expect(table.insert).not.toHaveBeenCalled();
  });

  it("removing one ends it rather than deleting it", async () => {
    given();
    await removeIncomeSource(form({ id: "i-1" }));
    expect(table.update).toHaveBeenCalledWith({ ended_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(table.delete).not.toHaveBeenCalled();
  });
});

describe("the bill list (REQ-94)", () => {
  it("adds a bill with its name, type and due day", async () => {
    given();
    const result = await saveBill({}, form({ name: " Rent ", kind: "rent", dueDay: "1" }));
    expect(result).toEqual({ saved: true });
    expect(table.insert).toHaveBeenCalledWith({ name: "Rent", kind: "rent", due_day: 1 });
  });

  it("changes a bill when the form carries its id", async () => {
    given();
    await saveBill({}, form({ id: "b-1", name: "Joint card", kind: "card", dueDay: "22" }));
    expect(table.update).toHaveBeenCalledWith({ name: "Joint card", kind: "card", due_day: 22 });
    expect(table.eq).toHaveBeenCalledWith("id", "b-1");
  });

  it.each([
    [{ name: "" }, "Give the bill a name."],
    [{ kind: "loan" }, "Choose rent, card or other."],
    [{ dueDay: "32" }, "The due day is a day of the month, 1 to 31."],
  ])("refuses %j", async (change, error) => {
    given();
    expect(await saveBill({}, form({ name: "Rent", kind: "rent", dueDay: "1", ...change }))).toEqual({ error });
  });

  it("removes a bill", async () => {
    given();
    await removeBill(form({ id: "b-1" }));
    expect(table.delete).toHaveBeenCalled();
    expect(table.eq).toHaveBeenCalledWith("id", "b-1");
  });

  it("won't let a member change the list", async () => {
    given({ admin: false });
    await expect(saveBill({}, form({ name: "Rent", kind: "rent", dueDay: "1" }))).rejects.toThrow(
      "REDIRECT:/finances",
    );
    await expect(removeBill(form({ id: "b-1" }))).rejects.toThrow("REDIRECT:/finances");
  });
});
