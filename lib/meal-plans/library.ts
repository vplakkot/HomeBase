import type { PlanStats } from "./plan";
import type { Recipe } from "./recipes";

// REQ-114: the recipe library's search, filters and sort. Sorting by
// rating comes with ratings (close a week and rate).

export const COOK_TIMES = [
  { value: "30", label: "30 min or less", fits: (minutes: number) => minutes <= 30 },
  { value: "60", label: "31 to 60 min", fits: (minutes: number) => minutes > 30 && minutes <= 60 },
  { value: "long", label: "Over an hour", fits: (minutes: number) => minutes > 60 },
] as const;

export const SORTS = [
  { value: "name", label: "Name" },
  { value: "last", label: "Last planned" },
  { value: "times", label: "Times planned" },
] as const;

export type LibraryQuery = { q?: string; cuisine?: string; meat?: string; method?: string; time?: string; sort?: string; hidden?: string };

export function libraryRecipes(recipes: readonly Recipe[], stats: ReadonlyMap<string, PlanStats>, query: LibraryQuery): Recipe[] {
  const search = query.q?.trim().toLowerCase() ?? "";
  const time = COOK_TIMES.find((option) => option.value === query.time);
  const showHidden = query.hidden === "yes";
  const kept = recipes.filter(
    (recipe) =>
      recipe.hidden === showHidden &&
      (!search || recipe.name.toLowerCase().includes(search)) &&
      (!query.cuisine || recipe.cuisine === query.cuisine) &&
      (!query.meat || recipe.main_meat === query.meat) &&
      (!query.method || recipe.cooking_method === query.method) &&
      (!time || (recipe.cook_minutes !== null && time.fits(recipe.cook_minutes))),
  );
  const byName = (a: Recipe, b: Recipe) => a.name.localeCompare(b.name);
  const stat = (recipe: Recipe) => stats.get(recipe.id) ?? { times: 0, last: null };
  // Most recent or most planned first; never-planned recipes last, by name.
  if (query.sort === "last") return kept.sort((a, b) => (stat(b).last ?? "").localeCompare(stat(a).last ?? "") || byName(a, b));
  if (query.sort === "times") return kept.sort((a, b) => stat(b).times - stat(a).times || byName(a, b));
  return kept.sort(byName);
}
