import type { PlanStats } from "./plan";
import type { Recipe } from "./recipes";

// REQ-114: the recipe library's search, filters and sort.

export const COOK_TIMES = [
  { value: "30", label: "30 min or less", fits: (minutes: number) => minutes <= 30 },
  { value: "60", label: "31 to 60 min", fits: (minutes: number) => minutes > 30 && minutes <= 60 },
  { value: "long", label: "Over an hour", fits: (minutes: number) => minutes > 60 },
] as const;

// REQ-174: a filter's "Not set" finds the recipes with nothing in that field,
// which a card saved by name alone has.
export const NOT_SET = "not-set";

export const SORTS = [
  { value: "name", label: "Name" },
  { value: "rating", label: "Rating" },
  { value: "last", label: "Last cooked" },
  { value: "times", label: "Times cooked" },
] as const;

export type LibraryQuery = { q?: string; cuisine?: string; meat?: string; method?: string; time?: string; sort?: string; hidden?: string };

export function libraryRecipes(
  recipes: readonly Recipe[],
  stats: ReadonlyMap<string, PlanStats>,
  query: LibraryQuery,
  averages: ReadonlyMap<string, number> = new Map(),
): Recipe[] {
  const search = query.q?.trim().toLowerCase() ?? "";
  const time = COOK_TIMES.find((option) => option.value === query.time);
  const notSet = (chosen: string | undefined, value: string | number | null) => (chosen === NOT_SET ? value === null || value === "" : !chosen || value === chosen);
  const showHidden = query.hidden === "yes";
  const kept = recipes.filter(
    (recipe) =>
      recipe.hidden === showHidden &&
      (!search || recipe.name.toLowerCase().includes(search)) &&
      notSet(query.cuisine, recipe.cuisine) &&
      notSet(query.meat, recipe.main_meat) &&
      notSet(query.method, recipe.cooking_method) &&
      (query.time === NOT_SET ? recipe.cook_minutes === null : !time || (recipe.cook_minutes !== null && time.fits(recipe.cook_minutes))),
  );
  const byName = (a: Recipe, b: Recipe) => a.name.localeCompare(b.name);
  const stat = (recipe: Recipe) => stats.get(recipe.id) ?? { times: 0, last: null };
  // Best rated, most recently cooked or most cooked first; unrated or never-cooked
  // recipes last, by name.
  if (query.sort === "rating") return kept.sort((a, b) => (averages.get(b.id) ?? 0) - (averages.get(a.id) ?? 0) || byName(a, b));
  if (query.sort === "last") return kept.sort((a, b) => (stat(b).last ?? "").localeCompare(stat(a).last ?? "") || byName(a, b));
  if (query.sort === "times") return kept.sort((a, b) => stat(b).times - stat(a).times || byName(a, b));
  return kept.sort(byName);
}
