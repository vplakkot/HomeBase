import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import {
  addDirectPayment,
  addPersonalCharge,
  enterBill,
  openMonth,
  removeDirectPayment,
  removePersonalCharge,
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
  table = {
    insert: vi.fn().mockResolvedValue({ error }),
    delete: vi.fn(() => ({ eq })),
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
  it("records the payer, the total and a note", async () => {
    given();
    const result = await addDirectPayment(
      {},
      form({ monthId: "m-1", payerId: "u-alex", amount: "64.20", note: "Groceries, Venmo" }),
    );
    expect(result).toEqual({ saved: true });
    expect(table.insert).toHaveBeenCalledWith({
      month_id: "m-1",
      payer_id: "u-alex",
      amount: 64.2,
      note: "Groceries, Venmo",
    });
  });

  it("needs all three", async () => {
    given();
    const base = { monthId: "m-1", payerId: "u-alex", amount: "10", note: "Taxi" };
    expect((await addDirectPayment({}, form({ ...base, payerId: "" }))).error).toBe("Who paid?");
    expect((await addDirectPayment({}, form({ ...base, amount: "-3" }))).error).toBe(
      "Enter the total, like 64.20.",
    );
    expect((await addDirectPayment({}, form({ ...base, note: "  " }))).error).toBe(
      "Add a note saying what it was for.",
    );
    expect(table.insert).not.toHaveBeenCalled();
  });

  it("removes a payment", async () => {
    given();
    await removeDirectPayment(form({ id: "d-1" }));
    expect(table.eq).toHaveBeenCalledWith("id", "d-1");
  });
});
