import type { PlanStats } from "./plan";
import type { Recipe } from "./recipes";

// REQ-118, REQ-175: the fun numbers on Meal Plans' home, from the library we still
// use (hidden recipes left out).
export type HomeStats = {
  mostCooked: { recipe: Recipe; times: number } | null;
  topRated: { recipe: Recipe; average: number } | null;
  recipes: number;
  cuisines: number;
};

export function homeStats(all: readonly Recipe[], stats: ReadonlyMap<string, PlanStats>, averages: ReadonlyMap<string, number>): HomeStats {
  const recipes = all.filter((recipe) => !recipe.hidden);
  let mostCooked: HomeStats["mostCooked"] = null;
  let topRated: HomeStats["topRated"] = null;
  // Ties go to the name first in the alphabet, so the answer doesn't flicker.
  for (const recipe of [...recipes].sort((a, b) => a.name.localeCompare(b.name))) {
    const times = stats.get(recipe.id)?.times ?? 0;
    if (times > 0 && times > (mostCooked?.times ?? 0)) mostCooked = { recipe, times };
    const average = averages.get(recipe.id);
    if (average !== undefined && average > (topRated?.average ?? 0)) topRated = { recipe, average };
  }
  const cuisines = new Set(recipes.flatMap((recipe) => (recipe.cuisine ? [recipe.cuisine] : [])));
  return { mostCooked, topRated, recipes: recipes.length, cuisines: cuisines.size };
}
