import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { fakeSupabase } from "../../../test/fake-supabase";
import { deletePayment, savePayment } from "./actions";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

let fake: ReturnType<typeof fakeSupabase>;

// The joint card: $600, with $150 already paid by Sam.
const JOINT = { name: "Joint card", amount: "600.00", payments: [{ id: "p-1", amount: "150.00" }] };

function given({ member = true, bill = JOINT as unknown } = {}) {
  fake = fakeSupabase({
    permissions: member ? ["use_modules"] : [],
    tables: { month_bills: bill ? [bill] : [], payments: [{ id: "p-1" }] },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

// The query object the action wrote through, for the payments table.
const paymentsQuery = () => {
  const call = fake.from.mock.calls.findIndex(([table]) => table === "payments");
  return fake.from.mock.results[call]?.value as Record<string, ReturnType<typeof vi.fn>> | undefined;
};

const base = { payerId: "u-alex", monthBillId: "mb-joint", amount: "200" };

beforeEach(() => vi.clearAllMocks());

describe("savePayment (REQ-57)", () => {
  it("logs who paid, how much and which bill it went to", async () => {
    given();
    expect(await savePayment({}, form(base))).toEqual({ saved: true });
    expect(paymentsQuery()?.insert).toHaveBeenCalledWith({
      payer_id: "u-alex",
      month_bill_id: "mb-joint",
      amount: 200,
    });
  });

  it("needs who paid, the amount and the bill", async () => {
    given();
    expect((await savePayment({}, form({ ...base, payerId: "" }))).error).toBe("Who paid?");
    expect((await savePayment({}, form({ ...base, amount: "0" }))).error).toBe("Enter the amount, like 180.00.");
    expect((await savePayment({}, form({ ...base, monthBillId: "" }))).error).toBe("Which bill did it go to?");
    expect(paymentsQuery()).toBeUndefined();
  });

  it("warns and saves nothing when the payment is more than what's left on the bill", async () => {
    given();
    expect((await savePayment({}, form({ ...base, amount: "450.01" }))).error).toBe(
      "That's more than the $450.00 left on Joint card. Nothing was saved.",
    );
    expect(paymentsQuery()).toBeUndefined();
    expect(await savePayment({}, form({ ...base, amount: "450" }))).toEqual({ saved: true });
  });

  it("refuses a bill with no amount entered yet", async () => {
    given({ bill: { name: "Rent", amount: null, payments: [] } });
    expect((await savePayment({}, form(base))).error).toBe("Enter Rent's amount before paying toward it.");
  });

  // Changing a payment doesn't count its old amount against itself.
  it("changes a payment, leaving its own old amount out of what's left", async () => {
    given();
    expect(await savePayment({}, form({ ...base, id: "p-1", amount: "600" }))).toEqual({ saved: true });
    const query = paymentsQuery();
    expect(query?.update).toHaveBeenCalledWith({ payer_id: "u-alex", month_bill_id: "mb-joint", amount: 600 });
    expect(query?.eq).toHaveBeenCalledWith("id", "p-1");
  });

  it("puts the database's refusal in words", async () => {
    given();
    vi.mocked(createClient).mockResolvedValue({
      ...fake,
      from: vi.fn((table: string) => {
        const query = fake.from(table) as Record<string, unknown>;
        if (table === "payments") {
          query.insert = vi.fn().mockResolvedValue({ error: { message: "The payments come to more than the bill" } });
        }
        return query;
      }),
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    expect((await savePayment({}, form(base))).error).toBe(
      "That's more than what's left on Joint card. Nothing was saved.",
    );
  });

  it("sends someone without use_modules back to Finances", async () => {
    given({ member: false });
    await expect(savePayment({}, form(base))).rejects.toThrow("REDIRECT:/finances");
  });
});

describe("savePayment on a payment that's gone", () => {
  it("says so rather than saved", async () => {
    fake = fakeSupabase({ permissions: ["use_modules"], tables: { month_bills: [JOINT], payments: [] } });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    expect((await savePayment({}, form({ ...base, id: "p-9" }))).error).toBe(
      "That payment was deleted in the meantime. Nothing was saved.",
    );
  });
});

describe("deletePayment (REQ-57)", () => {
  it("deletes the payment", async () => {
    given();
    await deletePayment(form({ id: "p-1" }));
    const query = paymentsQuery();
    expect(query?.delete).toHaveBeenCalled();
    expect(query?.eq).toHaveBeenCalledWith("id", "p-1");
  });
});
