import { describe, expect, it } from "vitest";
import { coversText, isPlanSize, nextPlanStart, planTile, type MealPlan } from "./plan";

const MONDAY = "2026-09-29";

// REQ-162: where the plan ahead starts is tested with the rules, in meals.test.ts.
describe("where the plan ahead starts (REQ-162)", () => {
  const plan = (starts_on: string, entries: { day: string; meal: "lunch" | "dinner"; size: 1 | 2 }[]) => ({
    starts_on,
    recipes: entries.map((entry, index) => ({ id: `e${index}`, recipe_id: "r", eating_out: false, meals: entry.size, meal_on: entry.day, meal: entry.meal, cooked: false, carry_over: false, added_at: "" })),
  });

  it("starts that same day when the last meal is a lunch, and the next day when it is a dinner", () => {
    expect(nextPlanStart(plan(MONDAY, [{ day: MONDAY, meal: "dinner", size: 2 }]))).toBe("2026-09-30");
    expect(nextPlanStart(plan(MONDAY, [{ day: MONDAY, meal: "dinner", size: 1 }]))).toBe("2026-09-30");
    expect(nextPlanStart(plan(MONDAY, [{ day: "2026-09-30", meal: "dinner", size: 1 }]))).toBe("2026-10-01");
  });

  it("counts an empty plan as its start day", () => {
    expect(nextPlanStart(plan(MONDAY, []))).toBe("2026-09-30");
  });
});

describe("the plan in words", () => {
  it("says how far it reaches", () => {
    expect(coversText({ day: "2026-10-04", meal: "lunch" }, true)).toBe("Covers through lunch, Sun, Oct 4");
    expect(coversText(null, false)).toBe("Add recipes to see how long the plan lasts");
  });

  it("allows a dish to be 2 meals or 1, nothing else", () => {
    expect([2, 1, 0, 3, 4].map(isPlanSize)).toEqual([true, true, false, false, false]);
  });
});

// Vin, 2026-09-29: the tile is about the current plan.
describe("Home's Meal Plans tile", () => {
  // Each dish dinner after dinner from the start day, at the sizes given.
  const plan = (sizes: (1 | 2)[]): MealPlan => ({
    id: "p",
    starts_on: "2026-09-29",
    starts_meal: "dinner",
    ahead: false,
    daysOff: new Set(),
    recipes: sizes.map((size, index) => ({
      id: `e${index}`,
      recipe_id: `r${index}`,
      eating_out: false,
      meals: size,
      meal_on: ["2026-09-29", "2026-09-30", "2026-10-01"][index],
      meal: "dinner" as const,
      cooked: false,
      carry_over: false,
      added_at: "",
    })),
  });

  it("says the plan's dates and how many recipes are in it", () => {
    expect(planTile(plan([2, 2])).status).toBe("Sep 29 – Oct 1 · 2 recipes");
    expect(planTile(plan([2])).status).toBe("Sep 29 – Sep 30 · 1 recipe");
  });

  it("gives just the start while it fits in a day, and says so with no plan or no recipes", () => {
    expect(planTile(plan([1])).status).toBe("Sep 29 · 1 recipe");
    expect(planTile(plan([])).status).toBe("Sep 29 · no recipes yet");
    expect(planTile(null).status).toBe("No plan yet");
  });

  it("doesn't count an evening out as a recipe", () => {
    const withOut = plan([2]);
    withOut.recipes.push({ id: "x", recipe_id: null, eating_out: true, meals: 1, meal_on: "2026-09-29", meal: "dinner", cooked: false, carry_over: false, added_at: "" });
    expect(planTile(withOut).status).toBe("Sep 29 – Sep 30 · 1 recipe");
  });

  it("is calm: no action items", () => {
    expect(planTile(plan([2])).actionItems).toEqual([]);
  });
});
