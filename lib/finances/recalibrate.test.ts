import { describe, expect, it } from "vitest";
import { annualIncome, budgetYearBefore, marchReview } from "./recalibrate";

const split = (effective_from: string) => ({ id: effective_from, effective_from, note: "", shares: [] });

describe("marchReview (REQ-69)", () => {
  it("asks for a review of April's split while it's March", () => {
    expect(marchReview("2027-03-01", [split("2026-04-01")])).toBe("2027-04-01");
    expect(marchReview("2027-03-31", [split("2026-04-01")])).toBe("2027-04-01");
  });

  it("doesn't ask outside March", () => {
    expect(marchReview("2027-02-28", [])).toBeNull();
    expect(marchReview("2027-04-01", [])).toBeNull();
  });

  it("stops asking once a split starting that April is saved", () => {
    expect(marchReview("2027-03-10", [split("2026-04-01"), split("2027-04-01")])).toBeNull();
  });
});

describe("budgetYearBefore", () => {
  it("is the April before up to the April the review is for", () => {
    expect(budgetYearBefore("2027-04-01")).toEqual({ from: "2026-04-01", to: "2027-04-01" });
  });
});

describe("annualIncome (REQ-69)", () => {
  const source = (owner_id: string, net_amount: number, cadence: "weekly" | "biweekly" | "monthly", ended_on: string | null = null) => ({
    id: `${owner_id}-${cadence}`,
    name: "",
    owner_id,
    net_amount,
    cadence,
    anchor_date: "2026-09-11",
    ended_on,
  });

  it("annualises each person's pay by how often it comes, and gives their share of both", () => {
    expect(
      annualIncome(
        [source("u-alex", 3000, "biweekly"), source("u-alex", 100, "weekly"), source("u-sam", 4000, "monthly"), source("u-sam", 9999, "monthly", "2026-06-01")],
        ["u-alex", "u-sam"],
      ),
    ).toEqual([
      { user_id: "u-alex", annual: 83200, percentOfBoth: 63.41 },
      { user_id: "u-sam", annual: 48000, percentOfBoth: 36.59 },
    ]);
  });

  it("has no share when nobody has income", () => {
    expect(annualIncome([], ["u-alex"])).toEqual([{ user_id: "u-alex", annual: 0, percentOfBoth: null }]);
  });
});
