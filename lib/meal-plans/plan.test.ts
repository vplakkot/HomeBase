import { describe, expect, it } from "vitest";
import { coversText, dayLabel, entryMeals, isPlanServings, layoutPlan, mealChoices, nextPlanStart, orderedFor, planEnd, planTile } from "./plan";

type Entry = { id: string; servings: 4 | 2; eating_out: boolean };
const four = (id: string): Entry => ({ id, servings: 4, eating_out: false });
const two = (id: string): Entry => ({ id, servings: 2, eating_out: false });
const out = (id: string): Entry => ({ id, servings: 2, eating_out: true });

// "Dinner Mon · Lunch Tue" for each entry, "gap: Lunch Tue" for a free lunch.
function shown(startsOn: string, entries: Entry[]) {
  return layoutPlan(startsOn, entries).rows.map((row) => (row.kind === "gap" ? `gap: ${entryMeals([row.meal])}` : `${row.entry.id}: ${entryMeals(row.meals)}`));
}

// 2026-09-28 is a Monday.
const MONDAY = "2026-09-28";

describe("the plan laid out by meal (REQ-164)", () => {
  it("gives a 4-serving recipe a dinner and the next day's lunch, and a 2-serving one a single meal", () => {
    expect(shown(MONDAY, [four("a")])).toEqual(["a: Dinner Mon · Lunch Tue"]);
    expect(shown(MONDAY, [two("a")])).toEqual(["a: Dinner Mon"]);
  });

  it("lays out the example from the requirement", () => {
    expect(shown(MONDAY, [four("a"), out("b"), two("c"), four("d")])).toEqual([
      "a: Dinner Mon · Lunch Tue",
      "b: Dinner Tue",
      "c: Lunch Wed",
      "d: Dinner Wed · Lunch Thu",
    ]);
  });

  it("starts a 4-serving recipe at the following dinner when the next free meal is a lunch, and says that lunch isn't planned", () => {
    expect(shown(MONDAY, [two("a"), two("b"), four("c")])).toEqual(["a: Dinner Mon", "b: Lunch Tue", "c: Dinner Tue · Lunch Wed"]);
    expect(shown(MONDAY, [two("a"), four("b")])).toEqual(["a: Dinner Mon", "gap: Lunch Tue", "b: Dinner Tue · Lunch Wed"]);
  });

  it("gives an evening out a dinner too, leaving a free lunch before it", () => {
    expect(shown(MONDAY, [two("a"), out("b")])).toEqual(["a: Dinner Mon", "gap: Lunch Tue", "b: Dinner Tue"]);
  });

  it("ends on the last meal used, and has no end for an empty plan", () => {
    expect(planEnd(MONDAY, [four("a"), four("b")])).toEqual({ day: "2026-09-30", meal: "lunch" });
    expect(planEnd(MONDAY, [two("a")])).toEqual({ day: MONDAY, meal: "dinner" });
    expect(planEnd(MONDAY, [])).toBeNull();
    expect(dayLabel("2026-10-04")).toBe("Sun, Oct 4");
  });

  it("crosses the end of a month", () => {
    expect(planEnd("2026-09-29", [four("a"), four("b"), four("c")])).toEqual({ day: "2026-10-02", meal: "lunch" });
  });

  it("says it in words", () => {
    expect(coversText({ day: "2026-10-04", meal: "lunch" }, true)).toBe("Covers through lunch, Sun, Oct 4");
    expect(coversText(null, false)).toBe("Add recipes to see how long the plan lasts");
  });

  it("allows 4 servings or 2, nothing else", () => {
    expect([4, 2, 3, 6].map(isPlanServings)).toEqual([true, true, false, false]);
  });
});

describe("moving an entry to a meal (REQ-164)", () => {
  const ids = (list: Entry[]) => list.map((entry) => entry.id);
  const a = four("a");
  const b = two("b");
  const c = four("c");

  it("offers every meal the plan reaches and the first free one after it", () => {
    expect(mealChoices(MONDAY, [a, b]).map((choice) => choice.label)).toEqual([
      "Dinner Mon, Sep 28",
      "Lunch Tue, Sep 29",
      "Dinner Tue, Sep 29",
      "Lunch Wed, Sep 30",
    ]);
  });

  it("puts the moved entry first when moved to the first dinner, and last when moved past the end", () => {
    expect(ids(orderedFor(MONDAY, [a, b], c, 0))).toEqual(["c", "a", "b"]);
    expect(ids(orderedFor(MONDAY, [a, b], c, 3))).toEqual(["a", "b", "c"]);
  });

  it("puts it between two entries when moved to the meal in between", () => {
    // a is Dinner Mon · Lunch Tue, then b at Dinner Tue.
    expect(ids(orderedFor(MONDAY, [a, b], c, 2))).toEqual(["a", "c", "b"]);
  });
});

// REQ-162: the plan ahead starts at the first dinner after the current plan's last meal.
describe("where the plan ahead starts (REQ-162)", () => {
  const plan = (starts_on: string, entries: Entry[]) => ({ starts_on, recipes: entries.map((entry) => ({ ...entry, recipe_id: "r", cooked: false, carry_over: false, position: 0, added_at: "" })) });

  it("starts that same day's dinner when the last meal is a lunch, and the next day when it is a dinner", () => {
    // Ends Tuesday lunch: Tuesday dinner is next.
    expect(nextPlanStart(plan(MONDAY, [four("a")]))).toBe("2026-09-29");
    // Ends Tuesday dinner: Wednesday.
    expect(nextPlanStart(plan(MONDAY, [four("a"), two("b")]))).toBe("2026-09-30");
    expect(nextPlanStart(plan(MONDAY, [four("a"), four("b")]))).toBe("2026-09-30");
  });

  it("moves with the plan's last meal", () => {
    expect(nextPlanStart(plan(MONDAY, [four("a"), out("b")]))).toBe("2026-09-30");
    expect(nextPlanStart(plan(MONDAY, [four("a"), two("b"), two("c")]))).toBe("2026-09-30");
    expect(nextPlanStart(plan("2026-09-29", [four("a"), out("b")]))).toBe("2026-10-01");
  });

  it("counts an empty plan as its start day", () => {
    expect(nextPlanStart(plan(MONDAY, []))).toBe("2026-09-29");
  });
});

// Vin, 2026-09-29: the tile is about the current plan.
describe("Home's Meal Plans tile", () => {
  const plan = (servings: (4 | 2)[]) => ({
    id: "p",
    starts_on: "2026-09-29",
    ahead: false,
    recipes: servings.map((size, index) => ({
      id: `e${index}`,
      recipe_id: `r${index}`,
      eating_out: false,
      servings: size,
      cooked: false,
      carry_over: false,
      position: index,
      added_at: "",
    })),
  });

  it("says the plan's dates and how many recipes are in it", () => {
    expect(planTile(plan([4, 4])).status).toBe("Sep 29 – Oct 1 · 2 recipes");
    expect(planTile(plan([4])).status).toBe("Sep 29 – Sep 30 · 1 recipe");
  });

  it("gives just the start while it fits in a day, and says so with no plan or no recipes", () => {
    expect(planTile(plan([2])).status).toBe("Sep 29 · 1 recipe");
    expect(planTile(plan([])).status).toBe("Sep 29 · no recipes yet");
    expect(planTile(null).status).toBe("No plan yet");
  });

  it("doesn't count an evening out as a recipe", () => {
    const withOut = plan([4]);
    withOut.recipes.push({ id: "x", recipe_id: null as unknown as string, eating_out: true, servings: 2, cooked: false, carry_over: false, position: 9, added_at: "" });
    expect(planTile(withOut).status).toBe("Sep 29 – Sep 30 · 1 recipe");
  });

  it("is calm: no action items", () => {
    expect(planTile(plan([4])).actionItems).toEqual([]);
  });
});
