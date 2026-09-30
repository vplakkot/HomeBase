import { describe, expect, it } from "vitest";
import { coversText, coversThrough, dayLabel, isPlanServings, planTile } from "./plan";

const dishes = (count: number, servings: 4 | 2 = 4) => Array.from({ length: count }, () => ({ servings }));

describe("how far the week's plan carries us", () => {
  // Vin, 2026-09-29: five 4-serving dishes for two people, from dinner on
  // the first day, reach lunch on the sixth.
  it("counts meals for everyone eating, from dinner on the start day", () => {
    expect(coversThrough("2026-09-29", dishes(5), 2)).toEqual({ day: "2026-10-04", meal: "lunch" });
    expect(dayLabel("2026-10-04")).toBe("Sun, Oct 4");
  });

  it("gives one 4-serving dish for two a dinner and the next day's lunch", () => {
    expect(coversThrough("2026-09-29", dishes(1), 2)).toEqual({ day: "2026-09-30", meal: "lunch" });
  });

  it("gives a 2-serving dish for two one dinner, and an odd number of dishes ends on a dinner", () => {
    expect(coversThrough("2026-09-29", dishes(1, 2), 2)).toEqual({ day: "2026-09-29", meal: "dinner" });
    expect(coversThrough("2026-09-29", [{ servings: 4 }, { servings: 2 }], 2)).toEqual({ day: "2026-09-30", meal: "dinner" });
  });

  it("follows the household's size, and ignores a serving that can't feed everyone", () => {
    expect(coversThrough("2026-09-29", dishes(1), 4)).toEqual({ day: "2026-09-29", meal: "dinner" });
    expect(coversThrough("2026-09-29", dishes(1, 2), 4)).toBeNull();
    expect(coversThrough("2026-09-29", [], 2)).toBeNull();
    expect(coversThrough("2026-09-29", dishes(1), 0)).toEqual({ day: "2026-10-01", meal: "lunch" });
  });

  it("crosses the end of a month", () => {
    expect(coversThrough("2026-09-29", dishes(3), 2)).toEqual({ day: "2026-10-02", meal: "lunch" });
  });

  it("says it in words", () => {
    expect(coversText({ day: "2026-10-04", meal: "lunch" }, true)).toBe("Covers through lunch, Sun, Oct 4");
    expect(coversText(null, true)).toBe("Not a whole meal yet");
    expect(coversText(null, false)).toBe("Add recipes to see how long the plan lasts");
  });

  it("allows 4 servings or 2, nothing else", () => {
    expect([4, 2, 3, 6].map(isPlanServings)).toEqual([true, true, false, false]);
  });
});

// Vin, 2026-09-29: the tile is about the current plan.
describe("Home's Meal Plans tile", () => {
  const plan = (servings: (4 | 2)[]) => ({
    id: "p",
    starts_on: "2026-09-29",
    recipes: servings.map((size, index) => ({ recipe_id: `r${index}`, servings: size, cooked: false, carry_over: false, added_at: "" })),
  });

  it("says the plan's dates and how many recipes are in it", () => {
    expect(planTile(plan([4, 4, 4, 4]), 2).status).toBe("Sep 29 – Oct 3 · 4 recipes");
    expect(planTile(plan([4]), 2).status).toBe("Sep 29 – Sep 30 · 1 recipe");
  });

  it("gives just the start while nothing is covered, and says so with no plan or no recipes", () => {
    expect(planTile(plan([2]), 4).status).toBe("Sep 29 · 1 recipe");
    expect(planTile(plan([]), 2).status).toBe("Sep 29 · no recipes yet");
    expect(planTile(null, 2).status).toBe("No plan yet");
  });

  it("is calm: no action items", () => {
    expect(planTile(plan([4]), 2).actionItems).toEqual([]);
  });
});
