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
// A 2-meal dish also has a second meal that can sit anywhere after the first
// (REQ-196). An entry saved before that has none written, and its second
// meal is the meal right after the first.
export type Sited = { id: string; eating_out: boolean; meals: EntrySize; meal_on: string; meal: MealKind; second_on?: string | null; second_meal?: MealKind | null };

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

type Slotted = Pick<Sited, "meal_on" | "meal" | "meals" | "second_on" | "second_meal">;

// The meal number of a 2-meal dish's second meal; null for a 1-meal entry.
export function secondIndex(entry: Pick<Slotted, "meal_on" | "meal" | "meals"> & Partial<Pick<Sited, "second_on" | "second_meal">>): number | null {
  if (entry.meals !== 2 || !entry.meal_on || !entry.meal) return null;
  if (entry.second_on && entry.second_meal) return mealIndex({ day: entry.second_on, meal: entry.second_meal });
  return startOf(entry) + 1;
}

// Every meal an entry sits on, as meal numbers: its first, then its second.
export function slotsOf(entry: Pick<Slotted, "meal_on" | "meal" | "meals"> & Partial<Pick<Sited, "second_on" | "second_meal">>): number[] {
  const second = secondIndex(entry);
  return second === null ? [startOf(entry)] : [startOf(entry), second];
}

export function coveredMeals(entry: Pick<Slotted, "meal_on" | "meal" | "meals"> & Partial<Pick<Sited, "second_on" | "second_meal">>): Meal[] {
  return slotsOf(entry).map(mealAtIndex);
}

// REQ-196: nobody eats the same dish at lunch and dinner on one day. After a
// dinner the second meal is the next lunch; after a lunch it is the next
// day's lunch (Vin, 2026-10-14).
export function defaultSecondIndex(first: number): number {
  return first % 2 === 1 ? first + 1 : first + 2;
}

type Placeable = Pick<Sited, "eating_out" | "meals"> & Partial<Pick<Sited, "meal_on" | "meal" | "second_on" | "second_meal">>;
export type Seat = { meal_on: string; meal: MealKind; second_on: string | null; second_meal: MealKind | null };

// Where an entry sits once its first meal is `at`. A 1-meal entry has no
// second. A 2-meal dish keeps its distance from the first when it moves to
// the same kind of meal (lunch to lunch); otherwise, or when it has no place
// yet, its second meal goes where it usually does.
export function seat(entry: Placeable, at: Meal): Seat {
  const index = mealIndex(at);
  let second: Meal | null = null;
  if (!entry.eating_out && entry.meals === 2) {
    const from = entry.meal_on && entry.meal ? mealIndex({ day: entry.meal_on, meal: entry.meal }) : null;
    const was = from === null ? null : secondIndex({ meal_on: entry.meal_on as string, meal: entry.meal as MealKind, meals: 2, second_on: entry.second_on, second_meal: entry.second_meal });
    const keeps = from !== null && was !== null && was > from && from % 2 === index % 2;
    second = mealAtIndex(keeps ? index + (was as number) - (from as number) : defaultSecondIndex(index));
  }
  return { meal_on: at.day, meal: at.meal, second_on: second?.day ?? null, second_meal: second?.meal ?? null };
}

type Shape = Pick<Sited, "eating_out" | "meals">;

// Anything can be put on any meal, lunch or dinner, a weekday lunch
// included, Eating out too: the plan is ours to arrange (Vin, 2026-10-14).
// Only the automatic choices keep to `usualStart`.
export function canStartAt(_entry: Shape, _at: Meal, _daysOff: ReadonlySet<string>): boolean {
  return true;
}

// Where an entry is put when nobody picks a meal: Eating out at a dinner, a
// 2-meal dish at a dinner or at a lunch on a weekend day (a weekday lunch is
// usually the leftovers of the night before). Not a rule for moving things
// by hand.
export function usualStart(entry: Shape, at: Meal, daysOff: ReadonlySet<string>): boolean {
  if (entry.eating_out) return at.meal === "dinner";
  return entry.meals === 1 || at.meal === "dinner" || isWeekendDay(at.day, daysOff);
}

// Why an entry can't start there, in words, or null when it can: nothing is
// refused for what the entry is, only for what is already on the meal.
export function cantStartBecause(entry: Shape, at: Meal, daysOff: ReadonlySet<string>): string | null {
  return canStartAt(entry, at, daysOff) ? null : "That meal can't take it.";
}

// The last meal anything in the plan covers; null for an empty plan.
export function planEnd(entries: readonly (Pick<Slotted, "meal_on" | "meal" | "meals"> & Partial<Pick<Sited, "second_on" | "second_meal">>)[]): Meal | null {
  if (entries.length === 0) return null;
  return mealAtIndex(Math.max(...entries.flatMap(slotsOf)));
}

// Who is on a meal: the entry that starts there or covers it from before.
export function occupant<T extends Sited>(entries: readonly T[], at: Meal, except?: string): T | null {
  const index = mealIndex(at);
  return entries.find((entry) => entry.id !== except && slotsOf(entry).includes(index)) ?? null;
}

// The first meal an entry that would start at `at` can't have, and the
// entry that has it; null when all its meals are free.
export function blockerAt<T extends Sited>(entries: readonly T[], entry: Placeable & { id: string }, at: Meal): { meal: Meal; by: T } | null {
  const seated = { ...entry, ...seat(entry, at) } as Sited;
  for (const index of slotsOf(seated)) {
    const meal = mealAtIndex(index);
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

// REQ-196: the meals a dish's second meal can go to: any meal after its
// first (and not on a day that has passed), up to the same reach a default
// second meal can have. Meals already taken are listed too: moving onto one
// is refused with a reason.
export function secondChoices(plan: PlanStart, entry: Pick<Sited, "meal_on" | "meal">, lockedBefore: string | null): Meal[] {
  const first = Math.max(startOf(entry) + 1, lockedBefore ? mealIndex({ day: lockedBefore, meal: "lunch" }) : -Infinity);
  const last = mealIndex(capMeal(plan.starts_on)) + 2;
  const choices: Meal[] = [];
  for (let i = first; i <= last; i++) choices.push(mealAtIndex(i));
  return choices;
}

// REQ-196: where a new dish (or one growing from 1 meal to 2) sits once its
// first meal is `at`. Its second meal goes where it usually does; when that
// is taken it goes to the first free meal after the first, as far as a
// second meal can reach. `taken` is the dish on the first meal; `full` is
// no free meal for the second.
export type Fit<T extends Sited = Sited> = { seat: Seat } | { taken: { meal: Meal; by: T } } | { full: true };

export function fitSeat<T extends Sited>(plan: PlanStart, entries: readonly T[], entry: Placeable & { id: string }, at: Meal): Fit<T> {
  const by = occupant(entries, at, entry.id);
  if (by) return { taken: { meal: at, by } };
  const usual = seat(entry, at);
  if (usual.second_on === null || usual.second_meal === null) return { seat: usual };
  const first = mealIndex(at);
  const reach = mealIndex(capMeal(plan.starts_on)) + 2;
  const wanted = mealIndex({ day: usual.second_on, meal: usual.second_meal });
  for (const index of [wanted, ...Array.from({ length: Math.max(0, reach - first) }, (_, i) => first + 1 + i)]) {
    if (index <= first || occupant(entries, mealAtIndex(index), entry.id)) continue;
    const second = mealAtIndex(index);
    return { seat: { ...usual, second_on: second.day, second_meal: second.meal } };
  }
  return { full: true };
}

// Moving a dish's first meal to `at` (Vin, 2026-10-14: every meal can be
// tinkered with). The second meal stays where it is when it is still after
// the first and free; otherwise it goes where it usually does, or the next
// free meal. `taken` is the dish on the new first meal; `full` is no free
// meal for the second.
export function refit<T extends Sited>(plan: PlanStart, entries: readonly T[], entry: T, at: Meal): Fit<T> {
  const by = occupant(entries, at, entry.id);
  if (by) return { taken: { meal: at, by } };
  if (entry.eating_out || entry.meals !== 2) return { seat: seat(entry, at) };
  const kept = secondIndex(entry);
  if (kept !== null && kept > mealIndex(at) && !occupant(entries, mealAtIndex(kept), entry.id)) {
    const second = mealAtIndex(kept);
    return { seat: { meal_on: at.day, meal: at.meal, second_on: second.day, second_meal: second.meal } };
  }
  return fitSeat(plan, entries, { id: entry.id, eating_out: false, meals: 2 }, at);
}

// The first free meal an entry can start at; null when the plan is full.
export function nextFreeMeal<T extends Sited>(plan: PlanStart, entries: readonly T[], entry: Placeable & { id: string }, daysOff: ReadonlySet<string>, lockedBefore: string | null): Meal | null {
  return startChoices(plan, entry, daysOff, lockedBefore).find((at) => usualStart(entry, at, daysOff) && "seat" in fitSeat(plan, entries, entry, at)) ?? null;
}

// Where next week's plan starts (REQ-170): at the meal right after the
// current plan's last filled meal (leftovers count as filled) when that is
// a lunch on a weekend day or Day off; otherwise at the next dinner. A plan
// with nothing in it counts its own first meal as filled.
export function nextWeekStart(plan: PlanStart, entries: readonly (Pick<Sited, "meal_on" | "meal" | "meals"> & Partial<Pick<Sited, "second_on" | "second_meal">>)[], daysOff: ReadonlySet<string>): Meal {
  const last = planEnd(entries) ?? planStartMeal(plan);
  const after = mealAtIndex(mealIndex(last) + 1);
  return after.meal === "lunch" && isWeekendDay(after.day, daysOff) ? after : { day: after.day, meal: "dinner" };
}

// Settling a shift (the reflow rule). Dishes keep their order and what
// kind of meal they are. A dish whose meals are taken goes to the next
// meal of its own kind that is free, and the dishes after it move along, in
// order. A dish is never moved off a meal just because of what it is. Eating out stays where
// it was put and dishes go round it. A dish's size never changes and a
// shift is never refused. Each entry arrives already shifted to where it
// would like to be.
export function reflow<T extends Sited>(entries: readonly T[], daysOff: ReadonlySet<string>): T[] {
  const fixed = entries.filter((entry) => entry.eating_out);
  const dishes = entries.filter((entry) => !entry.eating_out).sort((a, b) => startOf(a) - startOf(b));
  const taken = new Set(fixed.flatMap((out) => slotsOf(out)));
  const settled: T[] = [];
  let from = -Infinity;
  for (const dish of dishes) {
    // A dish keeps its kind of meal (a dinner stays a dinner): when it has to move, it goes to
    // the next lunch or dinner of its own kind that is free.
    let index = startOf(dish);
    if (index < from) index = from + ((from - index) % 2);
    for (;;) {
      const at = mealAtIndex(index);
      const seated = { ...dish, ...seat(dish, at) };
      const slots = slotsOf(seated);
      if (canStartAt(dish, at, daysOff) && !slots.some((slot) => taken.has(slot))) {
        settled.push(seated);
        for (const slot of slots) taken.add(slot);
        from = index;
        break;
      }
      index += 2;
    }
  }
  return [...fixed, ...settled];
}

// An entry moved by whole days: its second meal goes with it.
function shiftDays<T extends Sited>(entry: T, days: number): T {
  return { ...entry, meal_on: addDays(entry.meal_on, days), second_on: entry.second_on ? addDays(entry.second_on, days) : entry.second_on };
}

// A plan's start slides (REQ-163) or is changed: every dish moves by the
// same number of days, then settles. Eating out stays on the dinner it was
// put on: that is a booking, not part of the week's cooking.
export function slide<T extends Sited>(entries: readonly T[], days: number, daysOff: ReadonlySet<string>): T[] {
  return reflow(entries.map((entry) => (entry.eating_out ? entry : shiftDays(entry, days))), daysOff);
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
    if (entry.id === mine.id) return { ...entry, ...seat(entry, { day: other.meal_on, meal: other.meal }) };
    if (entry.id === other.id) return { ...entry, ...seat(entry, { day: mine.meal_on, meal: mine.meal }) };
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
// dish: its second meal moves to the next free meal instead (Vin, 2026-10-14).
export type Pushed<T> = { entries: T[]; dropped: T[] };

export function pushBack<T extends Sited>(plan: Pick<PlanStart, "starts_on">, entries: readonly T[], eatingOut: T, at: Meal, daysOff: ReadonlySet<string>): Pushed<T> | null {
  const rest = entries.filter((entry) => entry.id !== eatingOut.id);
  const on = occupant(rest, at);
  if (!on || on.eating_out) return null;
  // The dinner is the second meal of a dish that starts before it. The dish stays 2 meals (it was
  // shopped for as 2): its second meal moves to the next free meal, usually the next lunch, and
  // Eating out takes the dinner. Nothing else moves, nothing is dropped. With no free meal in
  // reach it shrinks to 1 meal instead.
  if (startOf(on) < mealIndex(at)) {
    const taken = new Set([startOf(on), mealIndex(at), ...rest.filter((entry) => entry.id !== on.id).flatMap((entry) => slotsOf(entry))]);
    const reach = mealIndex(capMeal(plan.starts_on)) + 2;
    let next = mealIndex(at) + (at.meal === "dinner" ? 1 : 2);
    while (next <= reach && taken.has(next)) next += 1;
    const second = next <= reach ? mealAtIndex(next) : null;
    const kept = rest.map((entry) => (entry.id === on.id ? { ...entry, meals: second ? (2 as const) : (1 as const), second_on: second?.day ?? null, second_meal: second?.meal ?? null } : entry));
    return { entries: [...kept, { ...eatingOut, meal_on: at.day, meal: at.meal, meals: 1 as const, second_on: null, second_meal: null }], dropped: [] };
  }
  const first = startOf(on);
  const pushed = new Set(rest.filter((entry) => !entry.eating_out && startOf(entry) >= first).map((entry) => entry.id));
  const shifted = rest.map((entry) => (pushed.has(entry.id) ? shiftDays(entry, 1) : entry));
  const placed = { ...eatingOut, meal_on: at.day, meal: at.meal, meals: 1 as const, second_on: null, second_meal: null };
  const settled = reflow([...shifted, placed], daysOff);
  const last = mealIndex(capMeal(plan.starts_on));
  const dropped = settled.filter((entry) => pushed.has(entry.id) && Math.max(...slotsOf(entry)) > last);
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
  const owner = new Map<number, T>();
  for (const entry of entries) for (const slot of slotsOf(entry)) owner.set(slot, entry);
  const rows: PlanRowLaid<T>[] = [];
  const first = Math.min(mealIndex(planStartMeal(plan)), ...entries.map(startOf));
  for (let index = first; index <= mealIndex(end); index++) {
    const entry = owner.get(index);
    if (entry) {
      // A dish is one card, at its first meal; its second meal is named on it.
      if (startOf(entry) === index) rows.push({ kind: "entry", entry, meals: coveredMeals(entry) });
    } else {
      const meal = mealAtIndex(index);
      rows.push({ kind: "empty", meal, label: meal.meal === "lunch" ? "On your own" : "Not planned" });
    }
  }
  return { rows, end };
}

// REQ-198: the plan a day at a time, a Lunch tile and a Dinner tile each.
// A tile is a dish's first meal, its second meal, or empty; the plan's first
// day starts at its first meal and its last day stops at its last filled one.
export type DaySlot<T> = { meal: Meal; kind: "first" | "second" | "empty"; entry?: T; label?: "On your own" | "Not planned" };
export type PlanDay<T> = { day: string; slots: DaySlot<T>[] };

export function layoutDays<T extends Sited>(plan: PlanStart, entries: readonly T[]): PlanDay<T>[] {
  const end = planEnd(entries);
  if (!end) return [];
  const owner = new Map<number, T>();
  for (const entry of entries) for (const slot of slotsOf(entry)) owner.set(slot, entry);
  const days: PlanDay<T>[] = [];
  const first = Math.min(mealIndex(planStartMeal(plan)), ...entries.map(startOf));
  for (let index = first; index <= mealIndex(end); index++) {
    const meal = mealAtIndex(index);
    const entry = owner.get(index);
    const slot: DaySlot<T> = entry
      ? { meal, kind: startOf(entry) === index ? "first" : "second", entry }
      : { meal, kind: "empty", label: meal.meal === "lunch" ? "On your own" : "Not planned" };
    const last = days.at(-1);
    if (last && last.day === meal.day) last.slots.push(slot);
    else days.push({ day: meal.day, slots: [slot] });
  }
  return days;
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
