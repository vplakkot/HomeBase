import { describe, expect, it } from "vitest";
import { coversText, isPlanSize, nextPlanStart, planTile, type MealPlan } from "./plan";

const MONDAY = "2026-09-29";

// REQ-170: the rules for where next week starts are tested with the rest, in meals.test.ts.
describe("where next week's plan starts (REQ-170)", () => {
  const plan = (starts_on: string, entries: { day: string; meal: "lunch" | "dinner"; size: 1 | 2 }[]): MealPlan => ({
    id: "p",
    starts_on,
    starts_meal: "dinner",
    ahead: false,
    status: "started",
    start_prompted_on: null,
    daysOff: new Set(),
    recipes: entries.map((entry, index) => ({ id: `e${index}`, recipe_id: "r", eating_out: false, meals: entry.size, meal_on: entry.day, meal: entry.meal, cooked: false, carry_over: false, didnt_cook: false, added_at: "" })),
  });

  it("starts at the meal after the plan's last filled meal: dinner, or a weekend lunch", () => {
    // Tuesday 2026-09-29: a 2-meal dish ends Wednesday lunch, so next week starts Wednesday dinner.
    expect(nextPlanStart(plan(MONDAY, [{ day: MONDAY, meal: "dinner", size: 2 }]))).toEqual({ day: "2026-09-30", meal: "dinner" });
    // A 1-meal dish on Friday 2026-10-02 dinner: Saturday lunch is next, and it's a weekend.
    expect(nextPlanStart(plan(MONDAY, [{ day: "2026-10-02", meal: "dinner", size: 1 }]))).toEqual({ day: "2026-10-03", meal: "lunch" });
  });

  it("counts an empty plan's first meal as filled", () => {
    expect(nextPlanStart(plan(MONDAY, []))).toEqual({ day: "2026-09-30", meal: "dinner" });
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
    status: "started",
    start_prompted_on: null,
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
      didnt_cook: false,
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
    withOut.recipes.push({ id: "x", recipe_id: null, eating_out: true, meals: 1, meal_on: "2026-09-29", meal: "dinner", cooked: false, carry_over: false, didnt_cook: false, added_at: "" });
    expect(planTile(withOut).status).toBe("Sep 29 – Sep 30 · 1 recipe");
  });

  it("is calm: no action items", () => {
    expect(planTile(plan([2])).actionItems).toEqual([]);
  });
});
