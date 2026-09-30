import type { SupabaseClient } from "@supabase/supabase-js";

// REQ-115: the week's plan. One plan is open at a time; both of us see
// and change it. Recipes go in at 4 servings (dinner and the next day's
// lunch) or 2 (one meal), with no day of their own.

export const PLAN_SERVINGS = [4, 2] as const;
export type PlanServings = (typeof PLAN_SERVINGS)[number];

export type PlannedRecipe = { recipe_id: string; servings: PlanServings; cooked: boolean; carry_over: boolean; added_at: string };
export type MealPlan = { id: string; starts_on: string; recipes: PlannedRecipe[] };

export function isPlanServings(value: number): value is PlanServings {
  return PLAN_SERVINGS.includes(value as PlanServings);
}

export async function readOpenPlan(supabase: SupabaseClient): Promise<MealPlan | null> {
  const { data, error } = await supabase
    .from("meal_plans")
    .select("id, starts_on, meal_plan_recipes(recipe_id, servings, cooked, carry_over, added_at)")
    .is("closed_at", null)
    .maybeSingle();
  if (error) throw new Error(`Could not read the plan: ${error.message}`);
  if (!data) return null;
  const row = data as { id: string; starts_on: string; meal_plan_recipes: PlannedRecipe[] | null };
  const recipes = [...(row.meal_plan_recipes ?? [])].sort((a, b) => a.added_at.localeCompare(b.added_at));
  return { id: row.id, starts_on: row.starts_on, recipes };
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
export type PlanRow = { plan_id: string; recipe_id: string; carry_over: boolean; meal_plans: { starts_on: string; closed_at: string | null } | null };

export async function readPlanRows(supabase: SupabaseClient): Promise<PlanRow[]> {
  const { data, error } = await supabase.from("meal_plan_recipes").select("plan_id, recipe_id, carry_over, meal_plans(starts_on, closed_at)");
  if (error) throw new Error(`Could not read planned recipes: ${error.message}`);
  return (data ?? []) as unknown as PlanRow[];
}

export function planStats(rows: readonly PlanRow[]): Map<string, PlanStats> {
  const stats = new Map<string, PlanStats>();
  for (const row of rows) {
    if (row.carry_over) continue;
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
  return rows.filter((row) => row.carry_over && row.plan_id === lastClosed).map((row) => row.recipe_id);
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

// How far the plan carries the household, counted in meals. A serving is
// one person's meal, so a plan of 20 servings for two people is 10 meals.
// The plan starts at dinner on its first day, and each day after has a
// lunch and a dinner: 4 servings for two people are that dinner and the
// next day's lunch. Five 4-serving dishes (10 meals) reach lunch on the
// sixth day. Null until there's a whole meal; a leftover serving that
// can't feed everyone doesn't count. (Vin, 2026-09-29; it replaced
// "a day per 4 servings", which ignored how many of us eat.)
export type Covers = { day: string; meal: "lunch" | "dinner" };

export function coversThrough(
  startsOn: string,
  recipes: readonly Pick<PlannedRecipe, "servings">[],
  eaters: number,
): Covers | null {
  const servings = recipes.reduce((sum, recipe) => sum + recipe.servings, 0);
  const meals = Math.floor(servings / Math.max(eaters, 1));
  if (meals < 1) return null;
  const last = meals - 1;
  // Meal 0 is the first dinner; odd meals are a lunch, the day after
  // the dinner before it.
  return last % 2 === 1 ? { day: addDays(startsOn, (last + 1) / 2), meal: "lunch" } : { day: addDays(startsOn, last / 2), meal: "dinner" };
}

// "Covers through lunch, Sun, Oct 4"
export function coversText(covers: Covers | null, anyPlanned: boolean): string {
  if (covers) return `Covers through ${covers.meal}, ${dayLabel(covers.day)}`;
  return anyPlanned ? "Not a whole meal yet" : "Add recipes to see how long the plan lasts";
}
