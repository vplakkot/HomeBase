import { describe, expect, it } from "vitest";
import { balanceTrend, cashCheck, startingPoint, type Balance } from "./balances";

const b = (month: string, user_id: string, account: Balance["account"], amount: number): Balance => ({
  month,
  user_id,
  account,
  amount,
});

describe("startingPoint (REQ-67)", () => {
  const rows = [b("2026-07-01", "u-alex", "cash", 100), b("2026-08-01", "u-alex", "cash", 250.5)];

  it("carries the latest earlier balance forward as a starting point", () => {
    expect(startingPoint(rows, "2026-09-01", "u-alex", "cash")).toEqual({ amount: 250.5, carried: true });
  });

  it("uses the month's own balance once entered", () => {
    expect(startingPoint(rows, "2026-08-01", "u-alex", "cash")).toEqual({ amount: 250.5, carried: false });
  });

  it("has nothing for an account never entered, or only entered later", () => {
    expect(startingPoint(rows, "2026-09-01", "u-alex", "401k")).toBeNull();
    expect(startingPoint(rows, "2026-06-01", "u-alex", "cash")).toBeNull();
  });
});

describe("balanceTrend (REQ-68)", () => {
  const rows = [
    b("2026-08-01", "u-alex", "401k", 10000),
    b("2026-08-01", "u-alex", "cash", 1000),
    b("2026-08-01", "u-sam", "cash", 500),
    b("2026-09-01", "u-alex", "401k", 10400.1),
    b("2026-09-01", "u-sam", "cash", 450),
  ];

  it("gives each month's combined total and its change over the accounts in both months, newest first", () => {
    const trend = balanceTrend(rows);
    // Alex's cash was skipped in September, so it's left out of the change
    // (+400.10 on the 401k, −50 on Sam's cash) rather than read as lost.
    expect(trend.map((row) => [row.month, row.total, row.change])).toEqual([
      ["2026-09-01", 10850.1, 350.1],
      ["2026-08-01", 11500, null],
    ]);
  });

  it("says when the change leaves out an account entered in only one month", () => {
    const [september, august] = balanceTrend(rows);
    expect(september.partial).toBe(true);
    expect(august.partial).toBe(false);
    const whole = balanceTrend([b("2026-08-01", "u-sam", "cash", 500), b("2026-09-01", "u-sam", "cash", 450)]);
    expect(whole[0]).toMatchObject({ change: -50, partial: false });
  });

  it("gives each account's movement, and shows a skipped account as a gap, not $0", () => {
    const [september] = balanceTrend(rows);
    expect(september.missing).toBe(1);
    expect(september.accounts).toEqual([
      { user_id: "u-alex", account: "401k", amount: 10400.1, change: 400.1 },
      { user_id: "u-alex", account: "cash", amount: null, change: null },
      { user_id: "u-sam", account: "cash", amount: 450, change: -50 },
    ]);
  });

  it("is empty with no balances", () => {
    expect(balanceTrend([])).toEqual([]);
  });
});

describe("cashCheck (REQ-65)", () => {
  it("compares the cash with the leftover", () => {
    expect(cashCheck(1400, 1300)).toEqual({ checked: true, cash: 1400, leftover: 1300, gap: 100, flagged: false });
  });

  it("flags cash more than $500 above the leftover", () => {
    expect(cashCheck(1800.01, 1300)).toMatchObject({ flagged: true });
    expect(cashCheck(1800, 1300)).toMatchObject({ flagged: false });
  });

  it("is skipped when no cash balance is entered, or there's no leftover yet", () => {
    expect(cashCheck(null, 1300)).toEqual({ checked: false });
    expect(cashCheck(900, null)).toEqual({ checked: false });
  });
});
