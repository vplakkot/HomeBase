import type { SupabaseClient } from "@supabase/supabase-js";

// REQ-172: Meal Plan's one household setting. "Repeat recipes in a plan" is
// off unless we turn it on: off, a recipe can be in only one of the plan
// we're on and next week's plan; on, it can be added more than once.
export type MealPlanSettings = { repeatRecipes: boolean };

export async function readSettings(supabase: SupabaseClient): Promise<MealPlanSettings> {
  const { data, error } = await supabase.from("meal_plan_settings").select("repeat_recipes").maybeSingle();
  if (error) throw new Error(`Could not read the Meal Plan settings: ${error.message}`);
  return { repeatRecipes: (data as { repeat_recipes: boolean } | null)?.repeat_recipes === true };
}
