import { describe, expect, it } from "vitest";
import type { Month, MonthBill } from "./month";
import { monthTotals } from "./month";
import { monthSummary, paymentsMade, progress } from "./overview";

const bill = (over: Partial<MonthBill>): MonthBill => ({
  id: "mb",
  name: "Bill",
  kind: "card",
  due_day: 1,
  amount: 100,
  personal_answer: "none",
  personal_charges: [],
  payments: [],
  ...over,
});

const month = (bills: MonthBill[], over: Partial<Month> = {}): Month => ({
  id: "m-1",
  starts_on: "2026-09-01",
  bills,
  direct_payments: [],
  income: [],
  closed_at: null,
  closed_by: null,
  closed_automatically: false,
  split_from: null,
  people: [],
  savings: [],
  ...over,
});

const SHARES = [
  { user_id: "u-alex", percent: 60 },
  { user_id: "u-sam", percent: 40 },
];

// REQ-103: the summary card.
describe("monthSummary", () => {
  const sept = month([
    bill({ id: "rent", kind: "rent", personal_answer: null, due_day: 1, amount: 2000, payments: [{ id: "p", payer_id: "u-alex", amount: 1200, created_at: "2026-09-02T15:00:00Z" }] }),
    bill({ id: "card", due_day: 25, amount: 600 }),
    bill({ id: "amazon", due_day: 28, amount: null, personal_answer: null }),
  ]);
  const summary = monthSummary(sept, monthTotals(sept, SHARES), "2026-09-22");

  it("adds up still to pay, the bills entered and what's paid", () => {
    expect(summary).toMatchObject({ stillToPay: 1400, bills: 2600, paid: 1200, percentPaid: 46, overdue: 1 });
  });

  it("marks a bill overdue once its due date has passed with money left", () => {
    expect(summary.rows.map((row) => [row.id, row.due, row.overdue, row.entered])).toEqual([
      ["rent", "2026-09-01", true, true],
      ["card", "2026-09-25", false, true],
      ["amazon", "2026-09-28", false, false],
    ]);
  });

  it("counts nothing late in a closed month", () => {
    const closed = { ...sept, closed_at: "2026-10-01T04:00:00Z" };
    expect(monthSummary(closed, monthTotals(closed, SHARES), "2026-10-05").overdue).toBe(0);
  });

  it("doesn't count an overpayment beyond the bill as paid", () => {
    const over = month([bill({ amount: 100, payments: [{ id: "p", payer_id: "u-alex", amount: 150, created_at: "2026-09-02T15:00:00Z" }] })]);
    expect(monthSummary(over, monthTotals(over, SHARES), "2026-09-22")).toMatchObject({ paid: 100, stillToPay: 0, percentPaid: 100 });
  });
});

describe("progress", () => {
  it("is a whole percent between 0 and 100", () => {
    expect(progress(1, 3)).toBe(33);
    expect(progress(5, 3)).toBe(100);
    expect(progress(0, 0)).toBe(0);
  });
});

// REQ-104.
describe("paymentsMade", () => {
  it("lists bill and one-time payments together, newest first, dated in household time", () => {
    const sept = month(
      [
        bill({
          id: "visa",
          name: "Visa",
          payments: [
            { id: "p-1", payer_id: "u-alex", amount: 600, created_at: "2026-09-03T15:00:00Z" },
            { id: "p-2", payer_id: "u-sam", amount: 400, created_at: "2026-09-19T03:00:00Z" },
          ],
        }),
      ],
      { direct_payments: [{ id: "d-1", payer_id: "u-sam", amount: 45, note: "Taxi", paid_on: "2026-09-10" }] },
    );
    expect(paymentsMade(sept)).toEqual([
      { id: "p-2", on: "2026-09-18", payerId: "u-sam", toward: "Visa", amount: 400 },
      { id: "d-1", on: "2026-09-10", payerId: "u-sam", toward: "Direct payment", amount: 45 },
      { id: "p-1", on: "2026-09-03", payerId: "u-alex", toward: "Visa", amount: 600 },
    ]);
  });
});
