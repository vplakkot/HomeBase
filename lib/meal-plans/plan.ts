import type { SupabaseClient } from "@supabase/supabase-js";

// REQ-115: the week's plan. One plan is open at a time; both of us see
// and change it. Recipes go in at 4 servings (dinner and the next day's
// lunch) or 2 (one meal), with no day of their own.

export const PLAN_SERVINGS = [4, 2] as const;
export type PlanServings = (typeof PLAN_SERVINGS)[number];

export type PlannedRecipe = { recipe_id: string; servings: PlanServings; cooked: boolean; added_at: string };
export type MealPlan = { id: string; starts_on: string; recipes: PlannedRecipe[] };

export function isPlanServings(value: number): value is PlanServings {
  return PLAN_SERVINGS.includes(value as PlanServings);
}

export async function readOpenPlan(supabase: SupabaseClient): Promise<MealPlan | null> {
  const { data, error } = await supabase
    .from("meal_plans")
    .select("id, starts_on, meal_plan_recipes(recipe_id, servings, cooked, added_at)")
    .is("closed_at", null)
    .maybeSingle();
  if (error) throw new Error(`Could not read the plan: ${error.message}`);
  if (!data) return null;
  const row = data as { id: string; starts_on: string; meal_plan_recipes: PlannedRecipe[] | null };
  const recipes = [...(row.meal_plan_recipes ?? [])].sort((a, b) => a.added_at.localeCompare(b.added_at));
  return { id: row.id, starts_on: row.starts_on, recipes };
}

// A recipe's times planned and date last planned (REQ-115, shown on the
// card and sorted by in the library), counted from every plan it's in.
export type PlanStats = { times: number; last: string | null };

export async function readPlanStats(supabase: SupabaseClient): Promise<Map<string, PlanStats>> {
  const { data, error } = await supabase.from("meal_plan_recipes").select("recipe_id, meal_plans(starts_on)");
  if (error) throw new Error(`Could not read planned recipes: ${error.message}`);
  const stats = new Map<string, PlanStats>();
  for (const row of (data ?? []) as unknown as { recipe_id: string; meal_plans: { starts_on: string } | null }[]) {
    const day = row.meal_plans?.starts_on ?? null;
    const now = stats.get(row.recipe_id) ?? { times: 0, last: null };
    stats.set(row.recipe_id, { times: now.times + 1, last: day && (!now.last || day > now.last) ? day : now.last });
  }
  return stats;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// "Sun, Sep 27"
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// REQ-115: a 4-serving recipe is one day and a 2-serving one half a day,
// counted from the start date. "At least" because a half day left over
// doesn't reach the next day. Null until the plan covers a whole day.
export function coversThrough(startsOn: string, recipes: readonly Pick<PlannedRecipe, "servings">[]): string | null {
  const days = recipes.reduce((sum, recipe) => sum + (recipe.servings === 4 ? 1 : 0.5), 0);
  return days >= 1 ? addDays(startsOn, Math.floor(days) - 1) : null;
}
