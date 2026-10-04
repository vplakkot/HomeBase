import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleStatus } from "../module-status";
import { addDays, dayAfterEnd, dayLabel, daysBetween, planEnd, slide, startOf, type EntrySize, type Meal, type MealKind, type Sited } from "./meals";

export { addDays };

// REQ-115: the week's plan. One plan is current and, since REQ-162, one
// more can be queued behind it; both of us see and change them. REQ-168: a
// plan is a run of meals, and each entry (a dish, or Eating out) is written
// onto the meal it starts at, with a size of 1 or 2 meals. The rules for
// that live in meals.ts.

export const PLAN_SIZES = [2, 1] as const;

export type PlannedRecipe = {
  id: string;
  recipe_id: string | null;
  eating_out: boolean;
  meals: EntrySize;
  meal_on: string;
  meal: MealKind;
  cooked: boolean;
  carry_over: boolean;
  added_at: string;
};
export type MealPlan = { id: string; starts_on: string; starts_meal: MealKind; ahead: boolean; recipes: PlannedRecipe[]; daysOff: Set<string> };

export function isPlanSize(value: number): value is EntrySize {
  return value === 1 || value === 2;
}

export const ENTRY_COLUMNS = "id, recipe_id, eating_out, meals, meal_on, meal, cooked, carry_over, added_at";

type PlanRowFromDb = {
  id: string;
  starts_on: string;
  starts_meal: MealKind;
  ahead: boolean | null;
  meal_plan_recipes: PlannedRecipe[] | null;
  meal_plan_days_off: { day: string }[] | null;
};

// The open plans as stored: the current one, and the one queued behind it.
// An entry without a meal yet (written by the app version running just
// before this one) is left out; the next migration gives it one.
export async function readStoredPlans(supabase: SupabaseClient): Promise<{ current: MealPlan | null; ahead: MealPlan | null }> {
  const { data, error } = await supabase
    .from("meal_plans")
    .select(`id, starts_on, starts_meal, ahead, meal_plan_recipes(${ENTRY_COLUMNS}), meal_plan_days_off(day)`)
    .is("closed_at", null);
  if (error) throw new Error(`Could not read the plan: ${error.message}`);
  const plans = ((data ?? []) as PlanRowFromDb[]).map((row) => ({
    id: row.id,
    starts_on: row.starts_on,
    starts_meal: row.starts_meal ?? "dinner",
    ahead: row.ahead === true,
    recipes: (row.meal_plan_recipes ?? []).filter((entry) => entry.meal_on && entry.meal && entry.meals).sort((a, b) => startOf(a) - startOf(b) || a.added_at.localeCompare(b.added_at)),
    daysOff: new Set((row.meal_plan_days_off ?? []).map((off) => off.day)),
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

// Write a plan's start and where each entry sits, in one step on the database.
export async function saveLayout(supabase: SupabaseClient, planId: string, startsOn: string, startsMeal: MealKind, entries: readonly Sited[]): Promise<void> {
  const layout = entries.map((entry) => ({ id: entry.id, meal_on: entry.meal_on, meal: entry.meal, meals: entry.meals }));
  const { error } = await supabase.rpc("set_plan_layout", { p_plan: planId, p_starts_on: startsOn, p_starts_meal: startsMeal, p_layout: layout });
  if (error) throw new Error(`Could not save the plan: ${error.message}`);
}

// Keeps the stored start of the plan ahead in step with the current plan,
// and its entries with it (they slide by the same number of days, then
// settle). Called after anything that changes what the current plan covers.
export async function syncAheadStart(supabase: SupabaseClient): Promise<void> {
  const { current, ahead } = await readStoredPlans(supabase);
  if (!current || !ahead) return;
  const start = nextPlanStart(current);
  if (ahead.starts_on === start) return;
  await saveLayout(supabase, ahead.id, start, ahead.starts_meal, slide(ahead.recipes, daysBetween(ahead.starts_on, start), ahead.daysOff));
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

// REQ-169: recipes a push took off a plan because the week ran out,
// to propose first.
export async function readProposed(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("meal_plan_proposed_next").select("recipe_id");
  if (error) throw new Error(`Could not read the proposed recipes: ${error.message}`);
  return ((data ?? []) as { recipe_id: string }[]).map((row) => row.recipe_id);
}

// REQ-116: what the last plan closed carried over, to propose first.
export function carriedOver(rows: readonly PlanRow[], lastClosed: string | null): string[] {
  return rows.flatMap((row) => (row.carry_over && row.plan_id === lastClosed && row.recipe_id ? [row.recipe_id] : []));
}

// REQ-162: the plan ahead starts at the first dinner after the current
// plan's last meal (Vin, 2026-10-04): the same day when that meal is a
// lunch, the next day when it is a dinner.
export function nextPlanStart(plan: Pick<MealPlan, "starts_on" | "recipes">): string {
  return dayAfterEnd(plan, plan.recipes);
}

export function coversText(covers: Meal | null, anyPlanned: boolean): string {
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
  const through = planEnd(plan.recipes);
  const days = through && through.day !== plan.starts_on ? `${shortDay(plan.starts_on)} – ${shortDay(through.day)}` : shortDay(plan.starts_on);
  return status(`${days} · ${recipes}`);
}
