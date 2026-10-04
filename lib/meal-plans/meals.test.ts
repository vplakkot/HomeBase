import { describe, expect, it } from "vitest";
import {
  blockerAt,
  canStartAt,
  capMeal,
  dayAfterEnd,
  entryMeals,
  isWeekendDay,
  layoutPlan,
  mealAtIndex,
  mealIndex,
  mealKey,
  nextFreeMeal,
  parseMealKey,
  planEnd,
  reflow,
  slide,
  startChoices,
  swapWithNeighbour,
  type EntrySize,
  type MealKind,
  type Sited,
} from "./meals";

// 2026-10-04 is a Sunday; the days after it are Mon 5th ... Sat 10th.
const SUN = "2026-10-04";
const MON = "2026-10-05";
const TUE = "2026-10-06";
const WED = "2026-10-07";
const THU = "2026-10-08";
const SAT = "2026-10-10";
const NONE: ReadonlySet<string> = new Set();

const dish = (id: string, meal_on: string, meal: MealKind, meals: EntrySize = 2): Sited => ({ id, eating_out: false, meals, meal_on, meal });
const out = (id: string, meal_on: string): Sited => ({ id, eating_out: true, meals: 1, meal_on, meal: "dinner" });
const where = (entries: Sited[]) => Object.fromEntries(entries.map((entry) => [entry.id, `${entry.meal} ${entry.meal_on}`]));

describe("meals as numbers (REQ-168)", () => {
  it("counts lunch then dinner, day after day, and turns back into the meal", () => {
    expect(mealIndex({ day: SUN, meal: "dinner" }) - mealIndex({ day: SUN, meal: "lunch" })).toBe(1);
    expect(mealIndex({ day: MON, meal: "lunch" }) - mealIndex({ day: SUN, meal: "dinner" })).toBe(1);
    expect(mealAtIndex(mealIndex({ day: "2026-12-31", meal: "dinner" }) + 1)).toEqual({ day: "2027-01-01", meal: "lunch" });
  });

  it("reads and writes the value a meal picker sends", () => {
    expect(mealKey({ day: MON, meal: "lunch" })).toBe("2026-10-05:lunch");
    expect(parseMealKey("2026-10-05:lunch")).toEqual({ day: MON, meal: "lunch" });
    expect([parseMealKey(""), parseMealKey("2026-10-05"), parseMealKey("2026-13-45:dinner"), parseMealKey("2026-10-05:brunch")]).toEqual([null, null, null, null]);
  });
});

describe("where an entry can start (REQ-168)", () => {
  const two = { eating_out: false, meals: 2 as const };
  const one = { eating_out: false, meals: 1 as const };

  it("lets a 2-meal dish start at any dinner, but at a lunch only on a weekend day", () => {
    expect(canStartAt(two, { day: TUE, meal: "dinner" }, NONE)).toBe(true);
    expect(canStartAt(two, { day: TUE, meal: "lunch" }, NONE)).toBe(false);
    expect(canStartAt(two, { day: SAT, meal: "lunch" }, NONE)).toBe(true);
    expect(canStartAt(two, { day: SUN, meal: "lunch" }, NONE)).toBe(true);
  });

  it("counts a Day off as a weekend day", () => {
    expect(isWeekendDay(TUE, NONE)).toBe(false);
    expect(isWeekendDay(TUE, new Set([TUE]))).toBe(true);
    expect(canStartAt(two, { day: TUE, meal: "lunch" }, new Set([TUE]))).toBe(true);
  });

  it("lets a 1-meal dish sit on any meal, and Eating out only on a dinner", () => {
    expect(canStartAt(one, { day: TUE, meal: "lunch" }, NONE)).toBe(true);
    expect(canStartAt({ eating_out: true, meals: 1 }, { day: TUE, meal: "dinner" }, NONE)).toBe(true);
    expect(canStartAt({ eating_out: true, meals: 1 }, { day: TUE, meal: "lunch" }, NONE)).toBe(false);
  });
});

describe("the plan laid out by meal (REQ-168)", () => {
  const plan = { starts_on: SUN, starts_meal: "dinner" as const };

  it("lays out the example: leftovers, a dinner not planned, a lunch on your own", () => {
    const rows = layoutPlan(plan, [dish("a", SUN, "dinner"), dish("b", TUE, "dinner")]).rows;
    expect(
      rows.map((row) => (row.kind === "empty" ? `${row.meal.meal} ${row.meal.day}: ${row.label}` : `${row.entry.id}: ${entryMeals(row.meals)}`)),
    ).toEqual([
      "a: Dinner Sun · Lunch Mon (leftovers)",
      "dinner 2026-10-05: Not planned",
      "lunch 2026-10-06: On your own",
      "b: Dinner Tue · Lunch Wed (leftovers)",
    ]);
  });

  it("ends at its last filled meal, leftovers included, and shows nothing for an empty plan", () => {
    expect(planEnd([dish("a", SUN, "dinner")])).toEqual({ day: MON, meal: "lunch" });
    expect(planEnd([dish("a", SUN, "dinner", 1)])).toEqual({ day: SUN, meal: "dinner" });
    expect(layoutPlan(plan, [])).toEqual({ rows: [], end: null });
  });

  it("shows the plan's own first meal when nothing is planned there yet", () => {
    const rows = layoutPlan(plan, [dish("a", MON, "dinner", 1)]).rows;
    expect(rows.map((row) => row.kind)).toEqual(["empty", "empty", "entry"]);
  });

  it("shows Eating out as its own card taking one dinner", () => {
    const rows = layoutPlan(plan, [out("x", SUN)]).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "entry", meals: [{ day: SUN, meal: "dinner" }] });
  });
});

describe("how far a plan reaches (REQ-168)", () => {
  it("ends at dinner on the first Saturday after the start day", () => {
    expect(capMeal(SUN)).toEqual({ day: SAT, meal: "dinner" });
    expect(capMeal(WED)).toEqual({ day: SAT, meal: "dinner" });
    // A plan that starts on a Saturday reaches the next one.
    expect(capMeal(SAT)).toEqual({ day: "2026-10-17", meal: "dinner" });
  });

  it("offers every meal a dish can start at, up to the cap", () => {
    const plan = { starts_on: SUN, starts_meal: "dinner" as const };
    const two = startChoices(plan, { eating_out: false, meals: 2 }, NONE, null).map(mealKey);
    expect(two[0]).toBe("2026-10-04:dinner");
    expect(two).toContain("2026-10-10:lunch");
    expect(two).not.toContain("2026-10-05:lunch");
    expect(two.at(-1)).toBe("2026-10-10:dinner");
    const one = startChoices(plan, { eating_out: false, meals: 1 }, NONE, null).map(mealKey);
    expect(one).toContain("2026-10-05:lunch");
  });

  it("leaves out locked days: those before today", () => {
    const plan = { starts_on: SUN, starts_meal: "dinner" as const };
    const choices = startChoices(plan, { eating_out: false, meals: 1 }, NONE, TUE).map(mealKey);
    expect(choices[0]).toBe("2026-10-06:lunch");
  });
});

describe("the next free meal (REQ-168)", () => {
  const plan = { starts_on: SUN, starts_meal: "dinner" as const };
  const candidate = (meals: EntrySize) => ({ id: "new", eating_out: false, meals });

  it("goes to the first free meal the dish can start at", () => {
    expect(nextFreeMeal(plan, [], candidate(2), NONE, null)).toEqual({ day: SUN, meal: "dinner" });
    // Sun dinner · Mon lunch taken: the next dinner.
    expect(nextFreeMeal(plan, [dish("a", SUN, "dinner")], candidate(2), NONE, null)).toEqual({ day: MON, meal: "dinner" });
    // A 1-meal dish takes the leftover-free lunch right away.
    expect(nextFreeMeal(plan, [dish("a", SUN, "dinner", 1)], candidate(1), NONE, null)).toEqual({ day: MON, meal: "lunch" });
  });

  it("needs both meals of a 2-meal dish to be free", () => {
    // Tue lunch is taken by a 1-meal dish, so Mon dinner (with Tue lunch) won't do either.
    const taken = [dish("a", SUN, "dinner"), dish("b", TUE, "lunch", 1)];
    expect(nextFreeMeal(plan, taken, candidate(2), NONE, null)).toEqual({ day: TUE, meal: "dinner" });
  });

  it("says which dish is in the way of a move", () => {
    const entries = [dish("a", SUN, "dinner")];
    const blocked = blockerAt(entries, candidate(1), { day: MON, meal: "lunch" });
    expect(blocked?.by.id).toBe("a");
    expect(blocked?.meal).toEqual({ day: MON, meal: "lunch" });
    expect(blockerAt(entries, { id: "a", eating_out: false, meals: 2 }, { day: SUN, meal: "dinner" })).toBeNull();
  });

  it("is null when the week is full", () => {
    const full = [SUN, MON, TUE, WED, THU, "2026-10-09", SAT].map((day, i) => dish(`d${i}`, day, "dinner"));
    expect(nextFreeMeal(plan, full, candidate(2), NONE, null)).toBeNull();
  });
});

describe("where the plan ahead starts (REQ-162)", () => {
  it("is the same day when the last meal is a lunch, the next when it is a dinner", () => {
    expect(dayAfterEnd({ starts_on: SUN }, [dish("a", SUN, "dinner")])).toBe(MON);
    expect(dayAfterEnd({ starts_on: SUN }, [dish("a", SUN, "dinner", 1)])).toBe(MON);
    expect(dayAfterEnd({ starts_on: SUN }, [dish("a", SUN, "dinner"), dish("b", MON, "dinner")])).toBe(TUE);
    expect(dayAfterEnd({ starts_on: SUN }, [])).toBe(MON);
  });
});

describe("the reflow rule (REQ-168)", () => {
  it("settles the requirement's example: a plan from Sunday lunch slides a day", () => {
    // A: lunch + dinner Sunday (a 2-meal dish at a weekend lunch), B: dinner Mon + lunch Tue.
    const before = [dish("A", SUN, "lunch"), dish("B", MON, "dinner")];
    expect(where(slide(before, 1, NONE))).toEqual({ A: "dinner 2026-10-05", B: "dinner 2026-10-06" });
  });

  it("keeps a dish where it was when it still fits, and keeps the order", () => {
    const moved = reflow([dish("B", WED, "dinner"), dish("A", MON, "dinner")], NONE);
    expect(where(moved)).toEqual({ A: "dinner 2026-10-05", B: "dinner 2026-10-07" });
  });

  it("moves a dish that lands on a weekday lunch to that day's dinner", () => {
    expect(where(reflow([dish("A", TUE, "lunch")], NONE))).toEqual({ A: "dinner 2026-10-06" });
  });

  it("leaves a 1-meal dish on a weekday lunch alone, and never changes a dish's size", () => {
    const moved = reflow([dish("A", TUE, "lunch", 1)], NONE);
    expect(where(moved)).toEqual({ A: "lunch 2026-10-06" });
    expect(moved[0].meals).toBe(1);
  });

  it("moves the dishes after along, in order, when one takes their place", () => {
    // A bumped to Mon dinner covers Tue lunch; B wants Mon dinner and goes to the next one.
    const moved = reflow([dish("A", MON, "lunch"), dish("B", MON, "dinner")], NONE);
    expect(where(moved)).toEqual({ A: "dinner 2026-10-05", B: "dinner 2026-10-06" });
  });

  it("goes round Eating out, which stays where it was put", () => {
    const moved = slide([dish("A", SUN, "dinner"), dish("B", MON, "dinner"), out("X", WED)], 1, NONE);
    expect(where(moved)).toEqual({ X: "dinner 2026-10-07", A: "dinner 2026-10-05", B: "dinner 2026-10-06" });
    // B would land on Wed dinner, where Eating out is, and goes to Thu.
    const crowded = slide([dish("A", SUN, "dinner"), dish("B", TUE, "dinner"), out("X", WED)], 1, NONE);
    expect(crowded.find((entry) => entry.id === "B")).toMatchObject({ meal_on: THU, meal: "dinner" });
  });
});

describe("swapping with the next dish (REQ-168)", () => {
  it("swaps places with the neighbour", () => {
    const entries = [dish("A", MON, "dinner"), dish("B", TUE, "dinner")];
    expect(where(swapWithNeighbour(entries, "B", -1, NONE) ?? [])).toEqual({ B: "dinner 2026-10-05", A: "dinner 2026-10-06" });
  });

  it("settles a dish that can't start where it lands", () => {
    // B is a 1-meal dish on Wed lunch. A (2 meals) can't start there, so it goes to Wed dinner.
    const entries = [dish("A", MON, "dinner"), dish("B", WED, "lunch", 1)];
    expect(where(swapWithNeighbour(entries, "A", 1, NONE) ?? [])).toEqual({ B: "dinner 2026-10-05", A: "dinner 2026-10-07" });
  });

  it("does nothing at the end of the order", () => {
    const entries = [dish("A", MON, "dinner"), dish("B", TUE, "dinner")];
    expect(swapWithNeighbour(entries, "A", -1, NONE)).toBeNull();
    expect(swapWithNeighbour(entries, "B", 1, NONE)).toBeNull();
  });

  it("skips Eating out: the dish swaps with the next dish, not with it", () => {
    const entries = [dish("A", MON, "dinner"), out("X", TUE), dish("B", WED, "dinner")];
    const swapped = swapWithNeighbour(entries, "A", 1, NONE) ?? [];
    expect(where(swapped)).toEqual({ X: "dinner 2026-10-06", B: "dinner 2026-10-05", A: "dinner 2026-10-07" });
  });
});
