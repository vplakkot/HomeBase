import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { addIncomeSource, removeBill, saveBill, saveBudgetYear } from "./actions";

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

describe("saveBudgetYear (REQ-50)", () => {
  const split = { startYear: "2026", "share:u-alex": "60", "share:u-sam": "40", note: " Both salaries as of March " };

  it("saves the April start year, each person's percentage and the note in one call", async () => {
    given();
    expect(await saveBudgetYear({}, form(split))).toEqual({
      saved: true,
      message: "Split saved for April 2026 – March 2027.",
    });
    expect(rpc).toHaveBeenCalledWith("save_budget_year", {
      p_start_year: 2026,
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
    const result = await saveBudgetYear({}, form({ ...split, "share:u-sam": "30" }));
    expect(result).toEqual({ error: "The percentages add up to 90%. They must total 100%." });
    expect(rpc).not.toHaveBeenCalledWith("save_budget_year", expect.anything());
  });

  it("accepts a split with decimals that totals exactly 100", async () => {
    given();
    const result = await saveBudgetYear({}, form({ ...split, "share:u-alex": "66.67", "share:u-sam": "33.33" }));
    expect(result).toMatchObject({ saved: true });
  });

  it.each([
    [{ startYear: "26" }, "Enter the year the budget year's April falls in, like 2026."],
    [{ "share:u-sam": "forty" }, "Each percentage must be a number from 0 to 100, with at most two decimals."],
  ])("refuses a bad form %j", async (change, error) => {
    given();
    expect(await saveBudgetYear({}, form({ ...split, ...change }))).toEqual({ error });
  });

  it("sends anyone without the manage_budget key back to Finances", async () => {
    given({ admin: false });
    await expect(saveBudgetYear({}, form(split))).rejects.toThrow("REDIRECT:/finances");
  });

  it("shows the database's refusal as-is (it checks the total too)", async () => {
    given({ error: { message: "The percentages must total 100; these total 90" } });
    expect(await saveBudgetYear({}, form(split))).toEqual({
      error: "The percentages must total 100; these total 90",
    });
  });
});

describe("addIncomeSource (REQ-51)", () => {
  const pay = {
    name: " Day job ",
    ownerId: "u-sam",
    netAmount: "$2,400.00",
    cadence: "biweekly",
    anchorDate: "2026-09-18",
  };

  it("records the name, owner, net amount per payment, cadence and anchor date", async () => {
    given();
    expect(await addIncomeSource({}, form(pay))).toEqual({ saved: true });
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
    expect(await addIncomeSource({}, form({ ...pay, ...change }))).toEqual({ error });
    expect(table.insert).not.toHaveBeenCalled();
  });

  it("is for admins only", async () => {
    given({ admin: false });
    await expect(addIncomeSource({}, form(pay))).rejects.toThrow("REDIRECT:/finances");
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
