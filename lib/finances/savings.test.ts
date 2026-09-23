import { describe, expect, it } from "vitest";
import { nothingToSaveReasons, savingsPlan } from "./savings";

const left = (sam: number, alex: number) => [
  { user_id: "u-sam", income: 0, obligation: 0, leftover: sam },
  { user_id: "u-alex", income: 0, obligation: 0, leftover: alex },
];
const names = (id: string) => (id === "u-sam" ? "Sam" : "Alex");

describe("joint savings from the lower leftover (REQ-63)", () => {
  it("has each person put in half of the lower leftover", () => {
    const plan = savingsPlan(left(100, 900));
    expect(plan.each).toBe(50);
    expect(plan.joint).toBe(100);
  });

  it("rounds an odd amount down to the dollar", () => {
    expect(savingsPlan(left(101, 900)).each).toBe(50);
    expect(savingsPlan(left(99.99, 900)).each).toBe(49);
  });

  it("leaves the rest of each leftover to its owner", () => {
    expect(savingsPlan(left(100, 900.25)).people.map((p) => p.yours)).toEqual([50, 850.25]);
  });
});

describe("nothing to save (REQ-64)", () => {
  it("means no joint saving when either leftover is zero or below", () => {
    expect(savingsPlan(left(0, 900)).joint).toBe(0);
    expect(savingsPlan(left(-120, 900)).joint).toBe(0);
  });

  it("says in words whose income fell short and that it came out of savings", () => {
    expect(nothingToSaveReasons(savingsPlan(left(-120, 900)), names)).toEqual([
      "Sam's income didn't cover their share: $120.00 came out of savings.",
    ]);
    expect(nothingToSaveReasons(savingsPlan(left(0, -5)), names)).toEqual([
      "Sam has nothing left after their share.",
      "Alex's income didn't cover their share: $5.00 came out of savings.",
    ]);
  });

  it("says why when the lower leftover is too small to halve into dollars", () => {
    const plan = savingsPlan(left(1.5, 900));
    expect(plan.joint).toBe(0);
    expect(nothingToSaveReasons(plan, names)).toEqual(["Sam has under $2 left, not enough to split."]);
  });

  it("keeps a positive leftover as the owner's when nobody saves jointly", () => {
    expect(savingsPlan(left(-120, 900)).people.map((p) => p.yours)).toEqual([0, 900]);
  });
});
