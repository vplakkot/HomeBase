// REQ-168: a plan is a run of meals. Meals go lunch, dinner, lunch,
// dinner..., and every entry in a plan (a dish, or Eating out) is written
// onto the meal it starts at, with a size of 1 or 2 meals. Nothing here
// touches the database or the screen: it is the rules, so they can be
// tested on their own. Household of two; weekday lunches are never cooked,
// they are the leftover half of the dinner before.

export type MealKind = "lunch" | "dinner";
export type Meal = { day: string; meal: MealKind };
export type EntrySize = 1 | 2;

// What the rules need to know about an entry.
export type Sited = { id: string; eating_out: boolean; meals: EntrySize; meal_on: string; meal: MealKind };

const DAY_MS = 86_400_000;

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
}

// Every meal has a number, counting up through time: lunch is even, dinner
// is odd. Comparing and stepping meals is then plain arithmetic.
export function mealIndex(at: Meal): number {
  return Math.round(Date.parse(`${at.day}T00:00:00Z`) / DAY_MS) * 2 + (at.meal === "dinner" ? 1 : 0);
}

export function mealAtIndex(index: number): Meal {
  return { day: new Date(Math.floor(index / 2) * DAY_MS).toISOString().slice(0, 10), meal: index % 2 === 1 ? "dinner" : "lunch" };
}

// "2026-10-05:lunch", the value a meal picker sends.
export function mealKey(at: Meal): string {
  return `${at.day}:${at.meal}`;
}

export function parseMealKey(value: unknown): Meal | null {
  const match = /^(\d{4}-\d{2}-\d{2}):(lunch|dinner)$/.exec(String(value ?? "").trim());
  return match && !Number.isNaN(Date.parse(`${match[1]}T12:00:00Z`)) ? { day: match[1], meal: match[2] as MealKind } : null;
}

// Saturday, Sunday, and any day we marked as a Day off.
export function isWeekendDay(day: string, daysOff: ReadonlySet<string>): boolean {
  const dow = weekday(day);
  return dow === 0 || dow === 6 || daysOff.has(day);
}

export function startOf(entry: Pick<Sited, "meal_on" | "meal">): number {
  return mealIndex({ day: entry.meal_on, meal: entry.meal });
}

export function coveredMeals(entry: Pick<Sited, "meal_on" | "meal" | "meals">): Meal[] {
  const start = startOf(entry);
  return Array.from({ length: entry.meals }, (_, i) => mealAtIndex(start + i));
}

type Shape = Pick<Sited, "eating_out" | "meals">;

// Eating out takes a dinner. A 1-meal dish can sit on any meal. A 2-meal
// dish covers its meal and the next, so it starts at a dinner, or at a
// lunch on a weekend day: a weekday lunch is the leftovers of the night
// before.
export function canStartAt(entry: Shape, at: Meal, daysOff: ReadonlySet<string>): boolean {
  if (entry.eating_out) return at.meal === "dinner";
  if (entry.meals === 1) return true;
  return at.meal === "dinner" || isWeekendDay(at.day, daysOff);
}

// Why an entry can't start there, in words, or null when it can.
export function cantStartBecause(entry: Shape, at: Meal, daysOff: ReadonlySet<string>): string | null {
  if (canStartAt(entry, at, daysOff)) return null;
  return entry.eating_out ? "Eating out takes a dinner." : "A 2-meal dish can't start at a weekday lunch.";
}

// The last meal anything in the plan covers; null for an empty plan.
export function planEnd(entries: readonly Pick<Sited, "meal_on" | "meal" | "meals">[]): Meal | null {
  if (entries.length === 0) return null;
  return mealAtIndex(Math.max(...entries.map((entry) => startOf(entry) + entry.meals - 1)));
}

// Who is on a meal: the entry that starts there or covers it from before.
export function occupant<T extends Sited>(entries: readonly T[], at: Meal, except?: string): T | null {
  const index = mealIndex(at);
  return entries.find((entry) => entry.id !== except && startOf(entry) <= index && index < startOf(entry) + entry.meals) ?? null;
}

// The first meal an entry that would start at `at` can't have, and the
// entry that has it; null when all its meals are free.
export function blockerAt<T extends Sited>(entries: readonly T[], entry: Shape & { id: string }, at: Meal): { meal: Meal; by: T } | null {
  const start = mealIndex(at);
  for (let i = 0; i < entry.meals; i++) {
    const meal = mealAtIndex(start + i);
    const by = occupant(entries, meal, entry.id);
    if (by) return { meal, by };
  }
  return null;
}

// Dinner on the first Saturday after the plan's start day: how far a plan
// reaches (we shop and cook for a week at a time).
export function capMeal(startsOn: string): Meal {
  const toSaturday = (6 - weekday(startsOn) + 7) % 7 || 7;
  return { day: addDays(startsOn, toSaturday), meal: "dinner" };
}

export type PlanStart = { starts_on: string; starts_meal: MealKind };

export function planStartMeal(plan: PlanStart): Meal {
  return { day: plan.starts_on, meal: plan.starts_meal };
}

// The meals an entry can start at, from the plan's first meal (or the
// first meal that isn't locked) up to the cap. Meals already taken are
// listed too: moving onto one is refused with a reason, not hidden.
export function startChoices(plan: PlanStart, entry: Shape, daysOff: ReadonlySet<string>, lockedBefore: string | null): Meal[] {
  const first = Math.max(mealIndex(planStartMeal(plan)), lockedBefore ? mealIndex({ day: lockedBefore, meal: "lunch" }) : -Infinity);
  const last = mealIndex(capMeal(plan.starts_on));
  const choices: Meal[] = [];
  for (let i = first; i <= last; i++) {
    const at = mealAtIndex(i);
    if (canStartAt(entry, at, daysOff)) choices.push(at);
  }
  return choices;
}

// The first free meal an entry can start at; null when the plan is full.
export function nextFreeMeal<T extends Sited>(plan: PlanStart, entries: readonly T[], entry: Shape & { id: string }, daysOff: ReadonlySet<string>, lockedBefore: string | null): Meal | null {
  return startChoices(plan, entry, daysOff, lockedBefore).find((at) => !blockerAt(entries, entry, at)) ?? null;
}

// Where next week's plan starts (REQ-170): at the meal right after the
// current plan's last filled meal (leftovers count as filled) when that is
// a lunch on a weekend day or Day off; otherwise at the next dinner. A plan
// with nothing in it counts its own first meal as filled.
export function nextWeekStart(plan: PlanStart, entries: readonly Pick<Sited, "meal_on" | "meal" | "meals">[], daysOff: ReadonlySet<string>): Meal {
  const last = planEnd(entries) ?? planStartMeal(plan);
  const after = mealAtIndex(mealIndex(last) + 1);
  return after.meal === "lunch" && isWeekendDay(after.day, daysOff) ? after : { day: after.day, meal: "dinner" };
}

// Settling a shift (the reflow rule). Dishes keep their order and what
// kind of meal they are. A dish that lands where it can't start goes to
// the next meal it can start at, and if that is taken the dishes after it
// move along, in order, to their next valid meals. Eating out stays where
// it was put and dishes go round it. A dish's size never changes and a
// shift is never refused. Each entry arrives already shifted to where it
// would like to be.
export function reflow<T extends Sited>(entries: readonly T[], daysOff: ReadonlySet<string>): T[] {
  const fixed = entries.filter((entry) => entry.eating_out);
  const dishes = entries.filter((entry) => !entry.eating_out).sort((a, b) => startOf(a) - startOf(b));
  const blocked = (index: number, size: number) => fixed.some((out) => startOf(out) < index + size && index < startOf(out) + out.meals);
  const settled: T[] = [];
  let free = -Infinity;
  for (const dish of dishes) {
    let index = Math.max(startOf(dish), free);
    while (!canStartAt(dish, mealAtIndex(index), daysOff) || blocked(index, dish.meals)) index += 1;
    const at = mealAtIndex(index);
    settled.push({ ...dish, meal_on: at.day, meal: at.meal });
    free = index + dish.meals;
  }
  return [...fixed, ...settled];
}

// A plan's start slides (REQ-163) or is changed: every dish moves by the
// same number of days, then settles. Eating out stays on the dinner it was
// put on: that is a booking, not part of the week's cooking.
export function slide<T extends Sited>(entries: readonly T[], days: number, daysOff: ReadonlySet<string>): T[] {
  return reflow(entries.map((entry) => (entry.eating_out ? entry : { ...entry, meal_on: addDays(entry.meal_on, days) })), daysOff);
}

// An up or down press: the dish swaps places with the dish next to it in
// meal order (Eating out is fixed and isn't swapped with), and the reflow
// rule settles whatever no longer fits. Null when there is no neighbour.
export function swapWithNeighbour<T extends Sited>(entries: readonly T[], id: string, step: -1 | 1, daysOff: ReadonlySet<string>): T[] | null {
  const dishes = entries.filter((entry) => !entry.eating_out).sort((a, b) => startOf(a) - startOf(b));
  const at = dishes.findIndex((entry) => entry.id === id);
  const other = dishes[at + step];
  if (at === -1 || !other) return null;
  const mine = dishes[at];
  const placed = entries.map((entry) => {
    if (entry.id === mine.id) return { ...entry, meal_on: other.meal_on, meal: other.meal };
    if (entry.id === other.id) return { ...entry, meal_on: mine.meal_on, meal: mine.meal };
    return entry;
  });
  return reflow(placed, daysOff);
}

// REQ-169: Eating out on a dinner that has a dish pushes that dish and
// every later dish back one day. Dishes keep their meal type (a dinner
// stays a dinner) and settle by the reflow rule round any Eating out; the
// Eating out entries already in the plan stay put. A dish pushed past the
// cap (dinner on the first Saturday after the plan's start day) leaves the
// plan: it is returned as `dropped`. `eatingOut` is the entry going onto
// `at`: new, or an existing one being moved there. Returns null when no
// dish is on that dinner, so nothing needs pushing. Eating out on the
// leftovers of a dish that starts at the lunch before it doesn't push that
// dish: it shrinks to 1 meal instead (Vin, 2026-10-04).
export type Pushed<T> = { entries: T[]; dropped: T[] };

export function pushBack<T extends Sited>(plan: Pick<PlanStart, "starts_on">, entries: readonly T[], eatingOut: T, at: Meal, daysOff: ReadonlySet<string>): Pushed<T> | null {
  const rest = entries.filter((entry) => entry.id !== eatingOut.id);
  const on = occupant(rest, at);
  if (!on || on.eating_out) return null;
  // The dinner is the leftovers of a 2-meal dish that starts at the lunch before it
  // (a weekend lunch). The dish keeps its lunch and becomes a 1-meal dish, and
  // Eating out takes the dinner: nothing else moves, nothing is dropped.
  if (startOf(on) < mealIndex(at)) {
    const kept = rest.map((entry) => (entry.id === on.id ? { ...entry, meals: 1 as const } : entry));
    return { entries: [...kept, { ...eatingOut, meal_on: at.day, meal: "dinner" as const, meals: 1 as const }], dropped: [] };
  }
  const first = startOf(on);
  const pushed = new Set(rest.filter((entry) => !entry.eating_out && startOf(entry) >= first).map((entry) => entry.id));
  const shifted = rest.map((entry) => (pushed.has(entry.id) ? { ...entry, meal_on: addDays(entry.meal_on, 1) } : entry));
  const placed = { ...eatingOut, meal_on: at.day, meal: "dinner" as const, meals: 1 as const };
  const settled = reflow([...shifted, placed], daysOff);
  const last = mealIndex(capMeal(plan.starts_on));
  const dropped = settled.filter((entry) => pushed.has(entry.id) && startOf(entry) + entry.meals - 1 > last);
  const gone = new Set(dropped.map((entry) => entry.id));
  return { entries: settled.filter((entry) => !gone.has(entry.id)), dropped };
}

export type PlanRowLaid<T> = { kind: "entry"; entry: T; meals: Meal[] } | { kind: "empty"; meal: Meal; label: "On your own" | "Not planned" };
export type PlanLayout<T> = { rows: PlanRowLaid<T>[]; end: Meal | null };

// The plan from its first meal to its last filled one: a card per entry
// with the meals it covers, and what an empty meal is called (a lunch
// nobody cooks for is "On your own", a dinner not yet decided is "Not
// planned"). Meals after the last filled one aren't shown.
export function layoutPlan<T extends Sited>(plan: PlanStart, entries: readonly T[]): PlanLayout<T> {
  const end = planEnd(entries);
  if (!end) return { rows: [], end: null };
  const byStart = new Map(entries.map((entry) => [startOf(entry), entry]));
  const rows: PlanRowLaid<T>[] = [];
  const first = Math.min(mealIndex(planStartMeal(plan)), ...entries.map(startOf));
  for (let index = first; index <= mealIndex(end); index++) {
    const entry = byStart.get(index);
    if (entry) {
      rows.push({ kind: "entry", entry, meals: coveredMeals(entry) });
      index += entry.meals - 1;
    } else {
      const meal = mealAtIndex(index);
      rows.push({ kind: "empty", meal, label: meal.meal === "lunch" ? "On your own" : "Not planned" });
    }
  }
  return { rows, end };
}

// "Dinner Mon"
export function mealName(meal: Meal): string {
  const day = new Date(`${meal.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${meal.meal === "dinner" ? "Dinner" : "Lunch"} ${day}`;
}

// "Sun, Sep 27"
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// "Dinner Mon, Oct 5", for picking a meal
export function mealPlace(meal: Meal): string {
  return `${meal.meal === "dinner" ? "Dinner" : "Lunch"} ${dayLabel(meal.day)}`;
}

// "Dinner Mon · Lunch Tue": the meals a dish covers, in plain words.
export function entryMeals(meals: readonly Meal[]): string {
  return meals.map(mealName).join(" · ");
}
