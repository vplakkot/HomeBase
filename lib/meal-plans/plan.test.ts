import { describe, expect, it } from "vitest";
import { coversThrough, dayLabel, isPlanServings } from "./plan";

describe("how far the week's plan carries us (REQ-115)", () => {
  it("counts a 4-serving recipe as a day and a 2-serving one as half, from the start date", () => {
    // Sunday 27 September 2026: two 4-serving and three 2-serving recipes are 3.5 days.
    const plan = [{ servings: 4 }, { servings: 4 }, { servings: 2 }, { servings: 2 }, { servings: 2 }] as const;
    expect(dayLabel(coversThrough("2026-09-27", plan) ?? "")).toBe("Tue, Sep 29");
  });

  it("reaches the start day itself with one 4-serving recipe, and no day with half of one", () => {
    expect(coversThrough("2026-09-27", [{ servings: 4 }])).toBe("2026-09-27");
    expect(coversThrough("2026-09-27", [{ servings: 2 }])).toBeNull();
    expect(coversThrough("2026-09-27", [])).toBeNull();
  });

  it("crosses the end of a month", () => {
    expect(coversThrough("2026-09-29", [{ servings: 4 }, { servings: 4 }, { servings: 4 }])).toBe("2026-10-01");
  });

  it("allows 4 servings or 2, nothing else", () => {
    expect([4, 2, 3, 6].map(isPlanServings)).toEqual([true, true, false, false]);
  });
});
