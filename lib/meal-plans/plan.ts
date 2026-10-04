import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleStatus } from "../module-status";

// REQ-115: the week's plan. One plan is current and, since REQ-162, one
// more can be queued behind it; both of us see and change them. A plan is
// an ordered list of entries: a recipe at 4 servings (a dinner and the next
// day's lunch) or 2 (one meal), or an evening out (REQ-164). Which meal an
// entry lands on is worked out from the order, never stored.

export const PLAN_SERVINGS = [4, 2] as const;
export type PlanServings = (typeof PLAN_SERVINGS)[number];

export type PlannedRecipe = {
  id: string;
  recipe_id: string | null;
  eating_out: boolean;
  servings: PlanServings;
  cooked: boolean;
  carry_over: boolean;
  position: number;
  added_at: string;
};
export type MealPlan = { id: string; starts_on: string; ahead: boolean; recipes: PlannedRecipe[] };

export function isPlanServings(value: number): value is PlanServings {
  return PLAN_SERVINGS.includes(value as PlanServings);
}

export const ENTRY_COLUMNS = "id, recipe_id, eating_out, servings, cooked, carry_over, position, added_at";

type PlanRowFromDb = { id: string; starts_on: string; ahead: boolean | null; meal_plan_recipes: PlannedRecipe[] | null };

// The open plans as stored: the current one, and the one queued behind it.
export async function readStoredPlans(supabase: SupabaseClient): Promise<{ current: MealPlan | null; ahead: MealPlan | null }> {
  const { data, error } = await supabase.from("meal_plans").select(`id, starts_on, ahead, meal_plan_recipes(${ENTRY_COLUMNS})`).is("closed_at", null);
  if (error) throw new Error(`Could not read the plan: ${error.message}`);
  const plans = ((data ?? []) as PlanRowFromDb[]).map((row) => ({
    id: row.id,
    starts_on: row.starts_on,
    ahead: row.ahead === true,
    recipes: [...(row.meal_plan_recipes ?? [])].sort((a, b) => a.position - b.position || a.added_at.localeCompare(b.added_at)),
  }));
  return { current: plans.find((plan) => !plan.ahead) ?? null, ahead: plans.find((plan) => plan.ahead) ?? null };
}

// What we show: the plan ahead starts at the first dinner after the current plan's last
// meal, wherever that has moved to (REQ-162).
export async function readPlans(supabase: SupabaseClient): Promise<{ current: MealPlan | null; ahead: MealPlan | null }> {
  const { current, ahead } = await readStoredPlans(supabase);
  return { current, ahead: ahead && current ? { ...ahead, starts_on: nextPlanStart(current) } : ahead };
}

export async function readOpenPlan(supabase: SupabaseClient): Promise<MealPlan | null> {
  return (await readPlans(supabase)).current;
}

// Keeps the stored start of the plan ahead in step with the current plan.
// Called after anything that changes what the current plan covers.
export async function syncAheadStart(supabase: SupabaseClient): Promise<void> {
  const { current, ahead } = await readStoredPlans(supabase);
  if (!current || !ahead) return;
  const start = nextPlanStart(current);
  if (ahead.starts_on === start) return;
  const { error } = await supabase.from("meal_plans").update({ starts_on: start }).eq("id", ahead.id).is("closed_at", null);
  if (error) throw new Error(`Could not move the next plan: ${error.message}`);
}

// The plan closed last, which can be reopened while no other is open.
export async function readLastClosedPlan(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("meal_plans")
    .select("id")
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the last plan: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

// A recipe's times planned and date last planned (REQ-115, shown on the
// card and sorted by in the library), counted from every plan it's in.
// A recipe carried over (REQ-116) wasn't really planned that week, so it
// counts once it's in a plan again. `first` is the day it was first
// planned, for "Try something new" (REQ-117).
export type PlanStats = { times: number; last: string | null; first: string | null };
export type PlanRow = { plan_id: string; recipe_id: string | null; carry_over: boolean; meal_plans: { starts_on: string; closed_at: string | null } | null };

export async function readPlanRows(supabase: SupabaseClient): Promise<PlanRow[]> {
  const { data, error } = await supabase.from("meal_plan_recipes").select("plan_id, recipe_id, carry_over, meal_plans(starts_on, closed_at)");
  if (error) throw new Error(`Could not read planned recipes: ${error.message}`);
  // An evening out is no recipe: it counts toward nothing.
  return ((data ?? []) as unknown as PlanRow[]).filter((row) => row.recipe_id !== null);
}

export function planStats(rows: readonly PlanRow[]): Map<string, PlanStats> {
  const stats = new Map<string, PlanStats>();
  for (const row of rows) {
    if (row.carry_over || row.recipe_id === null) continue;
    const day = row.meal_plans?.starts_on ?? null;
    const now = stats.get(row.recipe_id) ?? { times: 0, last: null, first: null };
    stats.set(row.recipe_id, {
      times: now.times + 1,
      last: day && (!now.last || day > now.last) ? day : now.last,
      first: day && (!now.first || day < now.first) ? day : now.first,
    });
  }
  return stats;
}

export async function readPlanStats(supabase: SupabaseClient): Promise<Map<string, PlanStats>> {
  return planStats(await readPlanRows(supabase));
}

// REQ-116: what the last plan closed carried over, to propose first.
export function carriedOver(rows: readonly PlanRow[], lastClosed: string | null): string[] {
  return rows.flatMap((row) => (row.carry_over && row.plan_id === lastClosed && row.recipe_id ? [row.recipe_id] : []));
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// "Sun, Sep 27"
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// REQ-164: the plan laid out by meal. Meals run from dinner on the start
// day: dinner, lunch, dinner, lunch... Slot 0 is that first dinner, slot 1
// the next day's lunch, and so on. A 4-serving recipe takes a dinner and
// the lunch after it; a 2-serving one takes the next free meal, dinner or
// lunch; an evening out takes one dinner. Whatever needs a dinner when the
// next free meal is a lunch starts at the following dinner, and that lunch
// shows as not planned. (Vin, 2026-10-04; it replaced counting servings
// per person, which made a plan's meals depend on how many of us eat.)
export type Covers = { day: string; meal: "lunch" | "dinner" };

export function mealAt(startsOn: string, slot: number): Covers {
  return slot % 2 === 1 ? { day: addDays(startsOn, (slot + 1) / 2), meal: "lunch" } : { day: addDays(startsOn, slot / 2), meal: "dinner" };
}

type Laid = Pick<PlannedRecipe, "servings" | "eating_out">;
export type PlanRowLaid<T> = { kind: "entry"; entry: T; slot: number; meals: Covers[] } | { kind: "gap"; slot: number; meal: Covers };
export type PlanLayout<T> = { rows: PlanRowLaid<T>[]; next: number; end: Covers | null };

export function layoutPlan<T extends Laid>(startsOn: string, entries: readonly T[]): PlanLayout<T> {
  const rows: PlanRowLaid<T>[] = [];
  let slot = 0;
  for (const entry of entries) {
    const needsDinner = entry.eating_out || entry.servings === 4;
    if (needsDinner && slot % 2 === 1) {
      rows.push({ kind: "gap", slot, meal: mealAt(startsOn, slot) });
      slot += 1;
    }
    const taken = !entry.eating_out && entry.servings === 4 ? 2 : 1;
    rows.push({ kind: "entry", entry, slot, meals: Array.from({ length: taken }, (_, i) => mealAt(startsOn, slot + i)) });
    slot += taken;
  }
  return { rows, next: slot, end: slot > 0 ? mealAt(startsOn, slot - 1) : null };
}

// "Dinner Mon"
export function mealName(meal: Covers): string {
  const weekday = new Date(`${meal.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${meal.meal === "dinner" ? "Dinner" : "Lunch"} ${weekday}`;
}

// "Dinner Mon, Oct 5", for picking a meal
export function mealPlace(meal: Covers): string {
  return `${meal.meal === "dinner" ? "Dinner" : "Lunch"} ${dayLabel(meal.day)}`;
}

// "Dinner Mon · Lunch Tue"
export function entryMeals(meals: readonly Covers[]): string {
  return meals.map(mealName).join(" · ");
}

// The meals a new or moved entry can be put on: every meal the plan
// reaches, and the first free one after them.
export function mealChoices(startsOn: string, entries: readonly Laid[]): { slot: number; label: string }[] {
  const { next } = layoutPlan(startsOn, entries);
  return Array.from({ length: next + 1 }, (_, slot) => ({ slot, label: mealPlace(mealAt(startsOn, slot)) }));
}

// The entries in the order that puts `moved` on `slot` (or the nearest
// meal it fits), with the others shifting to fill. Entries before it are
// those that start earlier than the chosen meal.
export function orderedFor<T extends Laid>(startsOn: string, others: readonly T[], moved: T, slot: number): T[] {
  const before = layoutPlan(startsOn, others).rows.flatMap((row) => (row.kind === "entry" && row.slot < slot ? [row.entry] : []));
  return [...before, moved, ...others.slice(before.length)];
}

// How far the plan carries us: its last meal.
export function planEnd(startsOn: string, entries: readonly Laid[]): Covers | null {
  return layoutPlan(startsOn, entries).end;
}

// REQ-162: the plan ahead starts at the first dinner after the current
// plan's last meal (Vin, 2026-10-04): the same day when that meal is a
// lunch, the next day when it is a dinner. A current plan with nothing in
// it yet counts as its start day.
export function nextPlanStart(plan: Pick<MealPlan, "starts_on" | "recipes">): string {
  const end = planEnd(plan.starts_on, plan.recipes);
  if (!end) return addDays(plan.starts_on, 1);
  return end.meal === "lunch" ? end.day : addDays(end.day, 1);
}

export function coversText(covers: Covers | null, anyPlanned: boolean): string {
  if (covers) return `Covers through ${covers.meal}, ${dayLabel(covers.day)}`;
  return anyPlanned ? "Not a whole meal yet" : "Add recipes to see how long the plan lasts";
}

// "Sep 29"
function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Home's tile is about the plan we're on, not the library (Vin,
// 2026-09-29): "Sep 29 – Oct 3 · 4 recipes", the start, the day it
// carries us through and what's in it. Calm, like the rest of the
// module: nothing here needs anyone.
export function planTile(plan: MealPlan | null): ModuleStatus {
  const status = (text: string): ModuleStatus => ({ status: text, headline: text, facts: [], actionItems: [] });
  if (!plan) return status("No plan yet");
  const count = plan.recipes.filter((entry) => !entry.eating_out).length;
  const recipes = count === 0 ? "no recipes yet" : count === 1 ? "1 recipe" : `${count} recipes`;
  const through = planEnd(plan.starts_on, plan.recipes);
  const days = through && through.day !== plan.starts_on ? `${shortDay(plan.starts_on)} – ${shortDay(through.day)}` : shortDay(plan.starts_on);
  return status(`${days} · ${recipes}`);
}
