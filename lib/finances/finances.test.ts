import { describe, expect, it } from "vitest";
import { dueLabel, ordinal } from "./bills";
import {
  budgetYearLabel,
  budgetYearStartFor,
  formatPercent,
  householdToday,
  parsePercent,
} from "./budget-year";
import { payDates } from "./income";
import { formatMoney, parseAmount } from "./money";

describe("budget years (REQ-50)", () => {
  it("puts every month from April through the following March in the same year", () => {
    const months = ["04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => `2026-${m}-15`);
    months.push("2027-01-15", "2027-02-15", "2027-03-31");
    expect(months.map(budgetYearStartFor)).toEqual(Array(12).fill(2026));
    expect(budgetYearStartFor("2026-03-31")).toBe(2025);
    expect(budgetYearStartFor("2027-04-01")).toBe(2027);
  });

  it("reads the household's day from one clock, in one time zone", () => {
    expect(householdToday(new Date("2027-03-31T23:30:00Z"))).toBe("2027-03-31");
    expect(householdToday(new Date("2027-04-01T00:30:00Z"))).toBe("2027-04-01");
  });

  it("names a budget year by its April and March", () => {
    expect(budgetYearLabel(2026)).toBe("April 2026 – March 2027");
  });

  it("reads percentages in hundredths, so 33.33 and 66.67 total exactly 100", () => {
    expect(parsePercent("33.33")! + parsePercent("66.67")!).toBe(100_00);
    expect(parsePercent(" 60 ")).toBe(60_00);
    expect(parsePercent("100")).toBe(100_00);
    expect(formatPercent(99_50)).toBe("99.5%");
  });

  it.each(["", "abc", "-5", "100.01", "150", "12.345"])("refuses %j as a percentage", (text) => {
    expect(parsePercent(text)).toBeNull();
  });
});

describe("paydays (REQ-51)", () => {
  it("projects a biweekly source forward from its anchor", () => {
    const source = { cadence: "biweekly" as const, anchor_date: "2026-09-11" };
    expect(payDates(source, "2026-09-22", 3)).toEqual(["2026-09-25", "2026-10-09", "2026-10-23"]);
    expect(payDates(source, "2026-09-25", 1)).toEqual(["2026-09-25"]);
  });

  it("counts back past the anchor too: it only needs to be one real payday", () => {
    const source = { cadence: "biweekly" as const, anchor_date: "2026-09-18" };
    expect(payDates(source, "2026-08-01", 2)).toEqual(["2026-08-07", "2026-08-21"]);
  });

  it("projects weekly and monthly sources, a 31st landing on a short month's last day", () => {
    expect(payDates({ cadence: "weekly", anchor_date: "2026-09-04" }, "2026-09-05", 2)).toEqual([
      "2026-09-11",
      "2026-09-18",
    ]);
    expect(payDates({ cadence: "monthly", anchor_date: "2026-01-31" }, "2027-01-31", 3)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });
});

describe("bills and money", () => {
  it("says when a bill is due", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "31st",
    ]);
    expect(dueLabel(1)).toBe("Due the 1st");
  });

  it("reads a typed amount and writes dollars", () => {
    expect(parseAmount("$2,400.50")).toBe(2400.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("12.345")).toBeNull();
    expect(formatMoney(2400.5)).toBe("$2,400.50");
  });
});
