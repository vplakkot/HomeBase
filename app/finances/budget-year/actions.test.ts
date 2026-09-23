import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import {
  removeBill,
  removeIncomeSource,
  removeSplit,
  saveBill,
  saveIncomeSource,
  saveSplit,
} from "./actions";

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
  const eq: ReturnType<typeof vi.fn> = vi.fn(() => chain) as never;
  const gte = vi.fn().mockResolvedValue({ error });
  const chain = { eq, gte, then: (go: (r: unknown) => unknown) => Promise.resolve({ error }).then(go) };
  table = {
    insert: vi.fn().mockResolvedValue({ error }),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq,
    gte,
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

describe("saveSplit (REQ-50, #132)", () => {
  // Dated ahead of any real "today", so the month-has-passed rule never
  // catches the ordinary cases below.
  const split = {
    effectiveFrom: "2099-10",
    "share:u-alex": "60",
    "share:u-sam": "40",
    note: " Both salaries as of March ",
  };

  it("saves the month it starts, each person's percentage and the note in one call", async () => {
    given();
    expect(await saveSplit({}, form(split))).toEqual({
      saved: true,
      message: "Split saved, from October 2099 onwards.",
    });
    expect(rpc).toHaveBeenCalledWith("save_split", {
      p_effective_from: "2099-10-01",
      p_today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
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
    [{ effectiveFrom: "2099" }, "Choose the month the new split starts in."],
    [{ "share:u-sam": "forty" }, "Each percentage must be a number from 0 to 100, with at most two decimals."],
  ])("refuses a bad form %j", async (change, error) => {
    given();
    expect(await saveSplit({}, form({ ...split, ...change }))).toEqual({ error });
  });

  it("sends anyone without the manage_budget key back to Finances", async () => {
    given({ admin: false });
    await expect(saveSplit({}, form(split))).rejects.toThrow("REDIRECT:/finances");
  });

  // #132: no door may reach back into a split whose month has passed —
  // not Edit, and not Add saving over the same month.
  it.each([["editing", "true"], ["adding", ""]])(
    "refuses %s a split whose month has passed",
    async (_door, editing) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2099-12-01T16:00:00Z"));
      given();
      const result = await saveSplit({}, form({ ...split, editing }));
      vi.useRealTimers();
      expect(result).toEqual({
        error: "That split has already started. Save one from this month or a later one.",
      });
      expect(rpc).not.toHaveBeenCalledWith("save_split", expect.anything());
    },
  );

  it("allows the month now running, which is how the first split is saved", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-10-20T16:00:00Z"));
    given();
    const result = await saveSplit({}, form({ ...split, editing: "true" }));
    vi.useRealTimers();
    expect(result).toMatchObject({ saved: true });
    expect(rpc).toHaveBeenCalledWith("save_split", expect.objectContaining({ p_today: "2099-10-20" }));
  });

  it("only ever deletes a split that hasn't started", async () => {
    given();
    await removeSplit(form({ id: "s-1" }));
    expect(table.delete).toHaveBeenCalled();
    expect(table.gte).toHaveBeenCalledWith("effective_from", expect.stringMatching(/^\d{4}-\d{2}-01$/));
  });

  it("shows the database's refusal as-is (it checks the total too)", async () => {
    given({ error: { message: "The percentages must total 100; these total 90" } });
    expect(await saveSplit({}, form(split))).toEqual({
      error: "The percentages must total 100; these total 90",
    });
  });
});

describe("saveIncomeSource (REQ-51, #132)", () => {
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
      effective_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
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

  // #132: a change starts a new source today rather than rewriting the
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
      p_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
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
  const TODAY = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);

  it("adds a bill with its name, type and due day", async () => {
    given();
    const result = await saveBill({}, form({ name: " Rent ", kind: "rent", dueDay: "1" }));
    expect(result).toEqual({ saved: true, message: "Bill added." });
    expect(rpc).toHaveBeenCalledWith("save_bill", {
      p_id: null,
      p_name: "Rent",
      p_kind: "rent",
      p_due_day: 1,
      p_apply: false,
      p_today: TODAY,
    });
  });

  it("changes a bill when the form carries its id, from the next month opened", async () => {
    given();
    const result = await saveBill({}, form({ id: "b-1", name: "Joint card", kind: "card", dueDay: "22" }));
    expect(result.message).toBe("Saved. It applies from the next month opened.");
    expect(rpc).toHaveBeenCalledWith("save_bill", expect.objectContaining({ p_id: "b-1", p_apply: false }));
  });

  // REQ-94, revised 2026-09-23: with the month open, the admin chooses
  // whether it takes the change too.
  it("brings the open month in line when the tick box is ticked", async () => {
    given();
    const result = await saveBill(
      {},
      form({ id: "b-1", name: "Joint card", kind: "card", dueDay: "22", applyToMonth: "on" }),
    );
    expect(result.message).toMatch(/^Saved, for \w+ \d{4} too\.$/);
    expect(rpc).toHaveBeenCalledWith("save_bill", expect.objectContaining({ p_apply: true }));
  });

  it.each([
    [{ name: "" }, "Give the bill a name."],
    [{ kind: "loan" }, "Choose rent, card or other."],
    [{ dueDay: "32" }, "The due day is a day of the month, 1 to 31."],
  ])("refuses %j", async (change, error) => {
    given();
    expect(await saveBill({}, form({ name: "Rent", kind: "rent", dueDay: "1", ...change }))).toEqual({ error });
  });

  it("retires a bill, leaving the open month alone unless asked", async () => {
    given();
    await removeBill(form({ id: "b-1" }));
    expect(rpc).toHaveBeenCalledWith("remove_bill", { p_id: "b-1", p_apply: false, p_today: TODAY });
    await removeBill(form({ id: "b-1", applyToMonth: "on" }));
    expect(rpc).toHaveBeenCalledWith("remove_bill", { p_id: "b-1", p_apply: true, p_today: TODAY });
  });

  it("won't let a member change the list", async () => {
    given({ admin: false });
    await expect(saveBill({}, form({ name: "Rent", kind: "rent", dueDay: "1" }))).rejects.toThrow(
      "REDIRECT:/finances",
    );
    await expect(removeBill(form({ id: "b-1" }))).rejects.toThrow("REDIRECT:/finances");
  });
});
