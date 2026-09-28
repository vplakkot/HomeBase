import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import {
  addDirectPayment,
  addPastMonth,
  addPersonalCharge,
  enterBill,
  openMonth,
  removeDirectPayment,
  removePersonalCharge,
  setMonthSplit,
  settleMonth,
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

// A member holds use_modules; `member: false` is someone without it.
function given({ member = true, error = null }: { member?: boolean; error?: { message: string } | null } = {}) {
  const eq = vi.fn().mockResolvedValue({ error });
  const maybeSingle = vi.fn().mockResolvedValue({ data: { starts_on: "2026-09-01" }, error: null });
  table = {
    insert: vi.fn().mockResolvedValue({ error }),
    delete: vi.fn(() => ({ eq })),
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
    eq,
  };
  rpc = vi.fn(async (fn: string) =>
    fn === "has_permission" ? { data: member, error: null } : { data: "month-id", error },
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

describe("openMonth (REQ-53, REQ-94)", () => {
  it("opens the month the household is in, as any member", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
    given();
    await openMonth();
    vi.useRealTimers();
    expect(rpc).toHaveBeenCalledWith("has_permission", { permission: "use_modules" });
    expect(rpc).toHaveBeenCalledWith("open_month", { p_month: "2026-09-22", p_today: "2026-09-22" });
    expect(revalidatePath).toHaveBeenCalledWith("/finances", "layout");
  });

  it("sends someone without use_modules back to Finances", async () => {
    given({ member: false });
    await expect(openMonth()).rejects.toThrow("REDIRECT:/finances");
    expect(rpc).not.toHaveBeenCalledWith("open_month", expect.anything());
  });
});

describe("enterBill", () => {
  it("saves rent with no personal-charges question (REQ-94)", async () => {
    given();
    const result = await enterBill({}, form({ id: "mb-rent", kind: "rent", amount: "$2,000" }));
    expect(result).toEqual({ saved: true });
    expect(rpc).toHaveBeenCalledWith("enter_bill", {
      p_month_bill: "mb-rent",
      p_amount: 2000,
      p_personal_answer: null,
    });
  });

  // REQ-54: the question can't be skipped silently.
  it("refuses a card statement without the personal-charges answer", async () => {
    given();
    const result = await enterBill({}, form({ id: "mb-card", kind: "card", amount: "900" }));
    expect(result.error).toBe("Say whether any personal charges are still inside this statement.");
    expect(rpc).not.toHaveBeenCalledWith("enter_bill", expect.anything());
  });

  it("saves a card statement with its answer", async () => {
    given();
    await enterBill({}, form({ id: "mb-card", kind: "card", amount: "900", personal: "some" }));
    expect(rpc).toHaveBeenCalledWith("enter_bill", {
      p_month_bill: "mb-card",
      p_amount: 900,
      p_personal_answer: "some",
    });
  });

  it("allows a statement of zero, and refuses anything that isn't an amount", async () => {
    given();
    expect(await enterBill({}, form({ id: "mb-card", kind: "card", amount: "0", personal: "none" }))).toEqual({
      saved: true,
    });
    expect((await enterBill({}, form({ id: "mb-rent", kind: "rent", amount: "lots" }))).error).toBe(
      "Enter the amount, like 1850.00.",
    );
  });

  it("explains when the charges already declared are more than the new amount", async () => {
    given({ error: { message: "The personal charges come to more than the statement" } });
    const result = await enterBill({}, form({ id: "mb-card", kind: "card", amount: "10", personal: "some" }));
    expect(result.error).toBe("The personal charges already declared come to more than that. Remove some first.");
  });
});

describe("addPersonalCharge (REQ-54)", () => {
  it("records an amount, whose it is and an optional note", async () => {
    given();
    const result = await addPersonalCharge(
      {},
      form({ monthBillId: "mb-card", ownerId: "u-sam", amount: "45.50", note: " Gift " }),
    );
    expect(result).toEqual({ saved: true });
    expect(table.insert).toHaveBeenCalledWith({
      month_bill_id: "mb-card",
      owner_id: "u-sam",
      amount: 45.5,
      note: "Gift",
    });
  });

  it("needs whose it is and an amount", async () => {
    given();
    expect((await addPersonalCharge({}, form({ monthBillId: "mb-card", amount: "5" }))).error).toBe(
      "Whose charge is it?",
    );
    expect(
      (await addPersonalCharge({}, form({ monthBillId: "mb-card", ownerId: "u-sam", amount: "" }))).error,
    ).toBe("Enter the charge's amount, like 45.00.");
    expect(table.insert).not.toHaveBeenCalled();
  });

  it("explains a refusal for going over the statement", async () => {
    given({ error: { message: "The personal charges come to more than the statement" } });
    const result = await addPersonalCharge({}, form({ monthBillId: "mb-card", ownerId: "u-sam", amount: "5000" }));
    expect(result.error).toBe("Personal charges can't come to more than the statement.");
  });

  it("removes a charge", async () => {
    given();
    await removePersonalCharge(form({ id: "c-1" }));
    expect(table.eq).toHaveBeenCalledWith("id", "c-1");
  });
});

describe("addDirectPayment (REQ-55)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const base = { monthId: "m-1", payerId: "u-alex", amount: "64.20", paidOn: "2026-09-05", note: "Groceries, Venmo" };

  it("records the payer, the total, the date paid and a note", async () => {
    given();
    const result = await addDirectPayment({}, form(base));
    expect(result).toEqual({ saved: true });
    expect(table.insert).toHaveBeenCalledWith({
      month_id: "m-1",
      payer_id: "u-alex",
      amount: 64.2,
      note: "Groceries, Venmo",
      paid_on: "2026-09-05",
    });
  });

  it("needs all four", async () => {
    given();
    expect((await addDirectPayment({}, form({ ...base, payerId: "" }))).error).toBe("Who paid?");
    expect((await addDirectPayment({}, form({ ...base, amount: "-3" }))).error).toBe(
      "Enter the total, like 64.20.",
    );
    expect((await addDirectPayment({}, form({ ...base, paidOn: "" }))).error).toBe("Enter the date it was paid.");
    expect((await addDirectPayment({}, form({ ...base, note: "  " }))).error).toBe(
      "Add a note saying what it was for.",
    );
    expect(table.insert).not.toHaveBeenCalled();
  });

  // Vin, 2026-09-23: always already paid, so no future dates.
  it("keeps the date paid inside the month and not after today", async () => {
    given();
    expect((await addDirectPayment({}, form({ ...base, paidOn: "2026-08-31" }))).error).toBe(
      "The date paid has to be in this month.",
    );
    expect((await addDirectPayment({}, form({ ...base, paidOn: "2026-09-23" }))).error).toBe(
      "A One-time Payment is already paid, so its date can't be in the future.",
    );
    expect(table.insert).not.toHaveBeenCalled();
  });

  it("removes a payment", async () => {
    given();
    await removeDirectPayment(form({ id: "d-1" }));
    expect(table.eq).toHaveBeenCalledWith("id", "d-1");
  });
});

// REQ-148: filling in an earlier month of this budget year. Invented ids.
const ALEX = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";

describe("addPastMonth (REQ-148)", () => {
  it("adds the month, as either member, and goes to its Monthly entry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T16:00:00Z"));
    given();
    await expect(addPastMonth(form({ month: "2026-05" }))).rejects.toThrow("REDIRECT:/finances/monthly-entry?month=2026-05");
    vi.useRealTimers();
    expect(rpc).toHaveBeenCalledWith("add_past_month", { p_month: "2026-05-01", p_today: "2026-09-22" });
    expect(revalidatePath).toHaveBeenCalledWith("/finances", "layout");
  });

  it("goes to the month anyway if the other person added it a moment ago", async () => {
    given({ error: { message: "That month is already there" } });
    await expect(addPastMonth(form({ month: "2026-05" }))).rejects.toThrow("REDIRECT:/finances/monthly-entry?month=2026-05");
  });

  it("before the budget year is set up, goes to Finances home, which says how", async () => {
    given({ error: { message: "Set up the budget year first" } });
    await expect(addPastMonth(form({ month: "2026-05" }))).rejects.toThrow("REDIRECT:/finances");
  });

  it("says why when the database refuses it", async () => {
    given({ error: { message: "Only an earlier month of this budget year can be added" } });
    await expect(addPastMonth(form({ month: "2025-05" }))).rejects.toThrow("Only an earlier month of this budget year");
  });

  it("does nothing with a month that isn't one, or for someone who isn't a member", async () => {
    given();
    await addPastMonth(form({ month: "May" }));
    expect(rpc).not.toHaveBeenCalledWith("add_past_month", expect.anything());
    given({ member: false });
    await expect(addPastMonth(form({ month: "2026-05" }))).rejects.toThrow("REDIRECT:/finances");
    expect(rpc).not.toHaveBeenCalledWith("add_past_month", expect.anything());
  });
});

describe("setMonthSplit (REQ-148)", () => {
  it("saves that month's own split", async () => {
    given();
    expect(await setMonthSplit({}, form({ monthId: "m-5", [`share_${ALEX}`]: "55.5", [`share_${SAM}`]: "44.5" }))).toEqual({ saved: true });
    expect(rpc).toHaveBeenCalledWith("set_month_split", {
      p_month: "m-5",
      p_shares: [
        { user_id: ALEX, percent: 55.5 },
        { user_id: SAM, percent: 44.5 },
      ],
    });
  });

  it("refuses percentages that don't total 100 or aren't percentages", async () => {
    given();
    expect(await setMonthSplit({}, form({ monthId: "m-5", [`share_${ALEX}`]: "60", [`share_${SAM}`]: "30" }))).toEqual({
      error: "The percentages add up to 90%. They must total 100%.",
    });
    expect((await setMonthSplit({}, form({ monthId: "m-5", [`share_${ALEX}`]: "lots" }))).error).toMatch(/from 0 to 100/);
    expect(rpc).not.toHaveBeenCalledWith("set_month_split", expect.anything());
  });
});

describe("settleMonth (REQ-148)", () => {
  it("settles the month, as either member, and shows it on Finances home", async () => {
    given();
    await expect(settleMonth({}, form({ monthId: "m-5", month: "2026-05" }))).rejects.toThrow("REDIRECT:/finances?month=2026-05");
    expect(rpc).toHaveBeenCalledWith("settle_past_month", { p_month: "m-5" });
  });

  it("asks for every bill first, in plain words", async () => {
    given({ error: { message: "Enter every bill before settling the month" } });
    expect(await settleMonth({}, form({ monthId: "m-5", month: "2026-05" }))).toEqual({
      error: "Enter every bill first ($0 is fine), so the year's totals have the whole month.",
    });
  });
});

