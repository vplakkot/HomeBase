import { describe, expect, it } from "vitest";
import { expectedPaychecks, INCOME_KINDS, leftovers, projectedIncome } from "./leftover";
import type { MonthIncome, MonthTotals } from "./month";

const biweekly = {
  id: "src-alex",
  name: "Acme pay",
  owner_id: "u-alex",
  net_amount: 2500,
  cadence: "biweekly" as const,
  anchor_date: "2026-09-04",
  effective_from: "2026-01-01",
  ended_on: null,
};

describe("expected paychecks (REQ-60)", () => {
  it("lists each payday in the month up to today, filled in from the income setup", () => {
    expect(expectedPaychecks([biweekly], "2026-09-01", "2026-09-20", [])).toEqual([
      { source_id: "src-alex", owner_id: "u-alex", name: "Acme pay", amount: 2500, payday: "2026-09-04" },
      { source_id: "src-alex", owner_id: "u-alex", name: "Acme pay", amount: 2500, payday: "2026-09-18" },
    ]);
  });

  it("drops a payday once it's confirmed", () => {
    const confirmed: MonthIncome = {
      id: "i-1",
      owner_id: "u-alex",
      kind: "paycheck",
      amount: 2480,
      received_on: "2026-09-04",
      income_source_id: "src-alex",
      note: "",
    };
    expect(expectedPaychecks([biweekly], "2026-09-01", "2026-09-20", [confirmed]).map((p) => p.payday)).toEqual([
      "2026-09-18",
    ]);
  });

  it("only uses a source on the days it was in force", () => {
    const ended = { ...biweekly, ended_on: "2026-09-10" };
    const started = { ...biweekly, id: "src-new", net_amount: 2700, effective_from: "2026-09-10" };
    expect(
      expectedPaychecks([ended, started], "2026-09-01", "2026-09-30", []).map((p) => `${p.source_id} ${p.payday}`),
    ).toEqual(["src-alex 2026-09-04", "src-new 2026-09-18"]);
  });

  it("offers ESPP and RSU sales, not shares kept", () => {
    expect(Object.values(INCOME_KINDS)).toEqual(["Paycheck", "ESPP sale", "RSU sale", "Bonus", "Other"]);
  });
});

describe("projected income (Vin, 2026-09-24)", () => {
  it("adds every payday still expected this month, past or coming, to what's confirmed", () => {
    const confirmed: MonthIncome = {
      id: "i-1", owner_id: "u-alex", kind: "paycheck", amount: 2480, received_on: "2026-09-04", income_source_id: "src-alex", note: "",
    };
    const { income, projected } = projectedIncome([biweekly], "2026-09-01", [confirmed]);
    expect(projected).toBe(true);
    expect(income.map((row) => [row.received_on, row.amount])).toEqual([
      ["2026-09-04", 2480],
      ["2026-09-18", 2500],
    ]);
  });

  it("isn't projected once every payday is confirmed", () => {
    const both: MonthIncome[] = ["2026-09-04", "2026-09-18"].map((day) => ({
      id: day, owner_id: "u-alex", kind: "paycheck", amount: 2500, received_on: day, income_source_id: "src-alex", note: "",
    }));
    expect(projectedIncome([biweekly], "2026-09-01", both)).toEqual({ income: both, projected: false });
  });
});

describe("whether the month moved you forward (REQ-61)", () => {
  const totals = {
    people: [
      { user_id: "u-alex", obligation: 1800 },
      { user_id: "u-sam", obligation: 1200.5 },
    ],
  } as MonthTotals;
  const income = (owner_id: string, amount: number): MonthIncome => ({
    id: `${owner_id}-${amount}`,
    owner_id,
    kind: "paycheck",
    amount,
    received_on: "2026-09-04",
    income_source_id: null,
    note: "",
  });

  it("is income minus obligation per person, and the two together", () => {
    const result = leftovers(totals, [income("u-alex", 2500), income("u-alex", 2500), income("u-sam", 1000.25)]);
    expect(result.people.map((p) => p.leftover)).toEqual([3200, -200.25]);
    expect(result.joint).toBe(2999.75);
  });

  it("comes to zero or less when income doesn't cover the shares", () => {
    expect(leftovers(totals, [income("u-alex", 1800), income("u-sam", 1200.5)]).joint).toBe(0);
    expect(leftovers(totals, []).joint).toBe(-3000.5);
  });
});
