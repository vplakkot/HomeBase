import { describe, expect, it } from "vitest";
import {
  blockerAt,
  canStartAt,
  capMeal,
  coveredMeals,
  entryMeals,
  fitSeat,
  isWeekendDay,
  layoutPlan,
  mealAtIndex,
  mealIndex,
  mealKey,
  nextFreeMeal,
  nextWeekStart,
  parseMealKey,
  planEnd,
  pushBack,
  reflow,
  seat,
  secondChoices,
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
      "a: Dinner Sun · Lunch Mon",
      "dinner 2026-10-05: Not planned",
      "lunch 2026-10-06: On your own",
      "b: Dinner Tue · Lunch Wed",
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

  it("gives a 2-meal dish a second meal that is free, the next one after the usual place if that is taken (REQ-196)", () => {
    // Tue lunch is taken by a 1-meal dish: Mon dinner still works, its second meal going to Tue dinner.
    const taken = [dish("a", SUN, "dinner"), dish("b", TUE, "lunch", 1)];
    expect(nextFreeMeal(plan, taken, candidate(2), NONE, null)).toEqual({ day: MON, meal: "dinner" });
    expect(fitSeat(plan, taken, candidate(2), { day: MON, meal: "dinner" })).toEqual({ seat: { meal_on: MON, meal: "dinner", second_on: TUE, second_meal: "dinner" } });
    expect(fitSeat(plan, taken, candidate(2), { day: SUN, meal: "dinner" })).toMatchObject({ taken: { by: { id: "a" } } });
  });

  it("says full only when no meal is left for the second meal, and can still fit a 1-meal dish (REQ-196)", () => {
    // Dinner Sat is free, but the two meals a second meal can reach after it (Sun lunch and dinner) are taken.
    const sat = { day: SAT, meal: "dinner" as MealKind };
    const sunday = [dish("s1", "2026-10-11", "lunch", 1), dish("s2", "2026-10-11", "dinner", 1)];
    expect(fitSeat(plan, sunday, candidate(2), sat)).toEqual({ full: true });
    expect(fitSeat(plan, sunday, candidate(1), sat)).toEqual({ seat: { meal_on: SAT, meal: "dinner", second_on: null, second_meal: null } });
    expect(fitSeat(plan, [sunday[0]], candidate(2), sat)).toMatchObject({ seat: { second_on: "2026-10-11", second_meal: "dinner" } });
  });

  it("fits a 2-meal dish into the week Vin hit on 2026-10-14, where it said the plan was full (REQ-196)", () => {
    // Tue dinner Eating out; Wed lunch+dinner; Thu dinner+Fri lunch; Sat lunch+dinner. Fri dinner is free.
    const week = { starts_on: "2026-10-13", starts_meal: "dinner" as const };
    const entries = [out("o", "2026-10-13"), dish("a", "2026-10-14", "lunch"), dish("b", "2026-10-15", "dinner"), dish("c", "2026-10-17", "lunch")];
    expect(nextFreeMeal(week, entries, candidate(2), NONE, null)).toEqual({ day: "2026-10-16", meal: "dinner" });
    expect(fitSeat(week, entries, candidate(2), { day: "2026-10-16", meal: "dinner" })).toMatchObject({ seat: { second_on: "2026-10-18", second_meal: "lunch" } });
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

describe("where next week's plan starts (REQ-170)", () => {
  const plan = { starts_on: SUN, starts_meal: "dinner" as const };
  const FRI = "2026-10-09";
  const start = (entries: Sited[], daysOff: ReadonlySet<string> = NONE) => mealKey(nextWeekStart(plan, entries, daysOff));

  it("starts at the next dinner after a 2-meal dish on Friday dinner, whose leftovers fill Saturday lunch", () => {
    expect(start([dish("a", FRI, "dinner")])).toBe("2026-10-10:dinner");
  });

  it("starts at Saturday lunch after a 1-meal dish on Friday dinner: a weekend lunch", () => {
    expect(start([dish("a", FRI, "dinner", 1)])).toBe("2026-10-10:lunch");
  });

  it("starts at the next dinner when the meal after is a weekday lunch", () => {
    expect(start([dish("a", SUN, "dinner", 1)])).toBe("2026-10-05:dinner");
    expect(start([dish("a", TUE, "dinner")])).toBe("2026-10-07:dinner");
  });

  it("counts a Day off as a weekend day, and an Eating out as a filled meal", () => {
    expect(start([dish("a", MON, "dinner", 1)], new Set([TUE]))).toBe("2026-10-06:lunch");
    expect(start([out("x", FRI)])).toBe("2026-10-10:lunch");
  });

  it("counts an empty plan's own first meal as filled, and moves with the last meal", () => {
    expect(start([])).toBe("2026-10-05:dinner");
    expect(start([dish("a", FRI, "dinner"), dish("b", SAT, "dinner", 1)])).toBe("2026-10-11:lunch");
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

describe("Eating out pushes dishes back (REQ-169)", () => {
  const plan = { starts_on: SUN };
  const x = out("X", TUE);
  const push = (entries: Sited[], eatingOut: Sited, at: { day: string; meal: MealKind }) => pushBack(plan, entries, eatingOut, at, NONE);

  it("moves a dish and every later dish back a day, keeping the meal type: the requirement's example", () => {
    // Chilli chicken on Tue dinner (leftovers Wed lunch), another dish after it on Thu dinner.
    const result = push([dish("chicken", TUE, "dinner"), dish("later", THU, "dinner")], x, { day: TUE, meal: "dinner" });
    expect(where(result?.entries ?? [])).toEqual({ X: "dinner 2026-10-06", chicken: "dinner 2026-10-07", later: "dinner 2026-10-09" });
    expect(result?.dropped).toEqual([]);
    // Wed lunch is the chicken's no more: it is empty, so a 1-meal dish can go there.
    expect(blockerAt(result?.entries ?? [], { id: "new", eating_out: false, meals: 1 }, { day: WED, meal: "lunch" })).toBeNull();
  });

  it("leaves dishes before the dinner where they are", () => {
    const result = push([dish("early", MON, "dinner"), dish("chicken", TUE, "dinner")], x, { day: TUE, meal: "dinner" });
    expect(where(result?.entries ?? [])).toEqual({ X: "dinner 2026-10-06", early: "dinner 2026-10-05", chicken: "dinner 2026-10-07" });
  });

  it("goes round Eating out already in the plan, which stays fixed", () => {
    // The chicken would land on Wed dinner, where Eating out already is, so it goes to Thu.
    const result = push([dish("chicken", TUE, "dinner"), out("Y", WED)], x, { day: TUE, meal: "dinner" });
    expect(where(result?.entries ?? [])).toEqual({ X: "dinner 2026-10-06", Y: "dinner 2026-10-07", chicken: "dinner 2026-10-08" });
  });

  it("moves a weekend-lunch dish's second meal to the next lunch when Eating out takes it, and moves nothing else", () => {
    // A 2-meal dish from Sat lunch (second meal Sat dinner, as saved before REQ-196). Eating out on Sat dinner keeps it 2 meals.
    const saturday = { starts_on: "2026-10-03" };
    const entries = [dish("weekend", "2026-10-03", "lunch"), dish("later", "2026-10-06", "dinner")];
    const result = pushBack(saturday, entries, out("X", "2026-10-03"), { day: "2026-10-03", meal: "dinner" }, NONE);
    expect(where(result?.entries ?? [])).toEqual({ weekend: "lunch 2026-10-03", X: "dinner 2026-10-03", later: "dinner 2026-10-06" });
    expect(result?.entries.find((entry) => entry.id === "weekend")).toMatchObject({ meals: 2, second_on: "2026-10-04", second_meal: "lunch" });
    expect(result?.entries.find((entry) => entry.id === "later")?.meals).toBe(2);
    expect(result?.dropped).toEqual([]);
  });

  it("pushes a dish cooked on that dinner, and a weekend-lunch dish that lands on a weekday starts at that day's dinner", () => {
    const saturday = { starts_on: "2026-10-03" };
    // Cooked on Sat dinner (a 2-meal dish covering Sunday lunch): pushed to Sunday dinner.
    const cooked = pushBack(saturday, [dish("c", "2026-10-03", "dinner")], out("X", "2026-10-03"), { day: "2026-10-03", meal: "dinner" }, NONE);
    expect(where(cooked?.entries ?? [])).toEqual({ X: "dinner 2026-10-03", c: "dinner 2026-10-04" });
    // A weekend-lunch dish after the pushed one that lands on a weekday lunch settles to that day's dinner.
    const later = pushBack(saturday, [dish("a", "2026-10-03", "dinner", 1), dish("b", "2026-10-04", "lunch")], out("X", "2026-10-03"), { day: "2026-10-03", meal: "dinner" }, NONE);
    expect(where(later?.entries ?? [])).toEqual({ X: "dinner 2026-10-03", a: "dinner 2026-10-04", b: "dinner 2026-10-05" });
  });

  it("drops a dish pushed past dinner on the first Saturday, and hands it back", () => {
    // Dinner Sat (the cap) is taken by the last dish; pushing it a day passes the cap.
    const result = push([dish("a", TUE, "dinner", 1), dish("last", SAT, "dinner", 1)], x, { day: TUE, meal: "dinner" });
    expect(result?.dropped.map((entry) => entry.id)).toEqual(["last"]);
    expect(where(result?.entries ?? [])).toEqual({ X: "dinner 2026-10-06", a: "dinner 2026-10-07" });
  });

  it("moves an Eating out already in the plan onto the dinner, and nothing is added twice", () => {
    const result = push([dish("chicken", TUE, "dinner"), out("X", THU)], out("X", THU), { day: TUE, meal: "dinner" });
    expect(where(result?.entries ?? [])).toEqual({ X: "dinner 2026-10-06", chicken: "dinner 2026-10-07" });
  });

  it("does nothing when no dish is on that dinner, or another Eating out is", () => {
    expect(push([dish("chicken", WED, "dinner")], x, { day: TUE, meal: "dinner" })).toBeNull();
    expect(push([out("Y", TUE)], x, { day: TUE, meal: "dinner" })).toBeNull();
  });
});

// REQ-196: a 2-meal dish's second meal has a place of its own.
describe("a second meal of its own (REQ-196)", () => {
  const FRI = "2026-10-09";
  const split = (id: string, meal_on: string, meal: MealKind, second_on: string, second_meal: MealKind): Sited => ({ ...dish(id, meal_on, meal), second_on, second_meal });

  it("puts the second meal on the next lunch after a dinner, and on the next day's lunch after a lunch", () => {
    expect(seat({ eating_out: false, meals: 2 }, { day: MON, meal: "dinner" })).toEqual({ meal_on: MON, meal: "dinner", second_on: TUE, second_meal: "lunch" });
    expect(seat({ eating_out: false, meals: 2 }, { day: FRI, meal: "lunch" })).toEqual({ meal_on: FRI, meal: "lunch", second_on: SAT, second_meal: "lunch" });
    expect(seat({ eating_out: false, meals: 1 }, { day: FRI, meal: "lunch" })).toEqual({ meal_on: FRI, meal: "lunch", second_on: null, second_meal: null });
  });

  it("keeps the second meal where it was written, or right after the first when none was", () => {
    expect(coveredNames(split("a", MON, "dinner", THU, "dinner"))).toEqual(["dinner 2026-10-05", "dinner 2026-10-08"]);
    expect(coveredNames(dish("a", MON, "dinner"))).toEqual(["dinner 2026-10-05", "lunch 2026-10-06"]);
    expect(planEnd([split("a", MON, "dinner", THU, "dinner")])).toEqual({ day: THU, meal: "dinner" });
  });

  it("keeps its distance when the first meal moves to the same kind of meal, and resets on another kind", () => {
    const a = split("a", MON, "dinner", THU, "dinner");
    expect(seat(a, { day: TUE, meal: "dinner" })).toMatchObject({ second_on: FRI, second_meal: "dinner" });
    expect(seat(a, { day: TUE, meal: "lunch" })).toMatchObject({ second_on: WED, second_meal: "lunch" });
  });

  it("refuses a move onto a meal that is a second meal, and says who is on it", () => {
    const a = split("a", MON, "dinner", THU, "dinner");
    expect(blockerAt([a], dish("b", THU, "dinner", 1), { day: THU, meal: "dinner" })?.by.id).toBe("a");
    // A 2-meal dish whose usual second meal is taken can't start there either.
    expect(blockerAt([dish("c", TUE, "lunch", 1)], dish("b", MON, "dinner"), { day: MON, meal: "dinner" })?.by.id).toBe("c");
  });

  it("lays a split dish out as one card at its first meal, with the meals between left open", () => {
    const rows = layoutPlan({ starts_on: MON, starts_meal: "dinner" }, [split("a", MON, "dinner", WED, "dinner")]).rows;
    expect(rows.map((row) => (row.kind === "entry" ? `${row.entry.id}: ${entryMeals(row.meals)}` : `${row.label} ${mealKey(row.meal)}`))).toEqual([
      "a: Dinner Mon · Dinner Wed",
      "On your own 2026-10-06:lunch",
      "Not planned 2026-10-06:dinner",
      "On your own 2026-10-07:lunch",
    ]);
  });

  it("lets a dish go between the two meals of another", () => {
    const a = split("a", MON, "dinner", THU, "dinner");
    expect(blockerAt([a], dish("b", TUE, "dinner"), { day: TUE, meal: "dinner" })).toBeNull();
  });

  it("slides the second meal with the first, and settles round it", () => {
    const a = split("a", FRI, "lunch", SAT, "dinner");
    expect(where(slide([a], 1, new Set([SAT, FRI])))).toEqual({ a: "lunch 2026-10-10" });
    expect(slide([a], 1, new Set([SAT, FRI]))[0]).toMatchObject({ second_on: "2026-10-11", second_meal: "dinner" });
    // A slide onto a weekday lunch goes to that day's dinner, second meal reset.
    const moved = slide([split("a", SUN, "lunch", MON, "lunch")], 1, NONE)[0];
    expect(moved).toMatchObject({ meal_on: MON, meal: "dinner", second_on: TUE, second_meal: "lunch" });
  });

  it("moves a dish's second meal to the next lunch when Eating out takes it, and pushes dishes that start on the dinner", () => {
    const a = split("a", FRI, "lunch", SAT, "dinner");
    const moved = pushBack({ starts_on: SUN }, [a], out("o", SAT), { day: SAT, meal: "dinner" }, new Set([FRI]));
    expect(moved?.entries.find((entry) => entry.id === "a")).toMatchObject({ meals: 2, second_on: "2026-10-11", second_meal: "lunch" });
    // The next lunch is taken: the next free meal after it.
    const busy = pushBack({ starts_on: SUN }, [a, dish("n", "2026-10-11", "lunch", 1)], out("o", SAT), { day: SAT, meal: "dinner" }, new Set([FRI]));
    expect(busy?.entries.find((entry) => entry.id === "a")).toMatchObject({ meals: 2, second_on: "2026-10-11", second_meal: "dinner" });
    // Nothing free in reach: it shrinks to 1 meal.
    const full = pushBack({ starts_on: SUN }, [a, dish("n", "2026-10-11", "lunch", 1), dish("m", "2026-10-11", "dinner", 1)], out("o", SAT), { day: SAT, meal: "dinner" }, new Set([FRI]));
    expect(full?.entries.find((entry) => entry.id === "a")).toMatchObject({ meals: 1, second_on: null, second_meal: null });
    const b = split("b", MON, "dinner", TUE, "lunch");
    const pushed = pushBack({ starts_on: SUN }, [b], out("o", MON), { day: MON, meal: "dinner" }, NONE);
    expect(pushed?.entries.find((entry) => entry.id === "b")).toMatchObject({ meal_on: TUE, second_on: WED });
  });

  it("offers every meal after the first for the second, from today on", () => {
    const first = { meal_on: MON, meal: "dinner" as MealKind };
    const all = secondChoices({ starts_on: SUN, starts_meal: "dinner" }, first, null);
    expect(all[0]).toEqual({ day: TUE, meal: "lunch" });
    expect(all.at(-1)).toEqual({ day: "2026-10-11", meal: "dinner" });
    expect(secondChoices({ starts_on: SUN, starts_meal: "dinner" }, first, THU)[0]).toEqual({ day: THU, meal: "lunch" });
  });
});

function coveredNames(entry: Sited) {
  return coveredMeals(entry).map((meal) => `${meal.meal} ${meal.day}`);
}
