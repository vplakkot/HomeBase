import type { SupabaseClient } from "@supabase/supabase-js";

// REQ-116: each of us rates a recipe 1 to 5 stars, once, and can change
// it anytime from the card. A new dish asks for the rating when its plan
// closes; the question stays until it's answered or skipped.

export type RecipeRating = { recipe_id: string; user_id: string; stars: number };

export async function readRatings(supabase: SupabaseClient): Promise<RecipeRating[]> {
  const { data, error } = await supabase.from("recipe_ratings").select("recipe_id, user_id, stars");
  if (error) throw new Error(`Could not read the ratings: ${error.message}`);
  return (data ?? []) as RecipeRating[];
}

// Our average per recipe; a recipe nobody has rated has none.
export function averageRatings(ratings: readonly RecipeRating[]): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const rating of ratings) {
    const now = sums.get(rating.recipe_id) ?? { total: 0, count: 0 };
    sums.set(rating.recipe_id, { total: now.total + rating.stars, count: now.count + 1 });
  }
  return new Map([...sums].map(([id, { total, count }]) => [id, total / count]));
}

// The recipes the signed-in person is asked to rate, oldest question first.
export async function readRatingPrompts(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("recipe_rating_prompts")
    .select("recipe_id, created_at")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error(`Could not read what to rate: ${error.message}`);
  return ((data ?? []) as { recipe_id: string }[]).map((row) => row.recipe_id);
}

// "★★★★☆"
export function starsText(stars: number): string {
  const whole = Math.round(stars);
  return "★".repeat(whole) + "☆".repeat(5 - whole);
}
