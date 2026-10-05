import { addDays, type PlanStats } from "./plan";
import type { Recipe } from "./recipes";

// REQ-117: recipes suggested while we build a plan. The app only
// suggests; we choose. Worked out from the whole library every time, so a
// new recipe never pushes an old favourite out for good.

export type SuggestionLabel = "Carried over" | "Try something new" | "Forgotten gem" | "New to try";
export type Suggestion = { recipe: Recipe; label: SuggestionLabel | null };

// How many suggestions to show in all (REQ-165): anything carried over
// first, then "Try something new", then the best ranked.
export const SUGGESTIONS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_COOK_MINUTES = 45;
// A recipe nobody has rated yet ranks as middling, not as bad.
const UNRATED = 3;

// A dish's natural gap between plans: the longer it takes, the longer the
// gap. A quick one is ready again in about two weeks, a 2-hour one in
// about a month.
export function naturalGapDays(cookMinutes: number | null): number {
  const minutes = Math.min(cookMinutes ?? UNKNOWN_COOK_MINUTES, 240);
  return 7 + (minutes * 23) / 120;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
}

// Higher is sooner. Rating counts as a share of 5 stars; "due" is how far
// through its natural gap the dish is, capped so one long-forgotten dish
// can't outrank every favourite by distance alone. Never cooked counts
// as a little overdue.
export function score(recipe: Recipe, stats: PlanStats | undefined, average: number | undefined, today: string): number {
  const rating = (average ?? UNRATED) / 5;
  const due = stats?.last ? Math.min(daysBetween(stats.last, today) / naturalGapDays(recipe.cook_minutes), 3) : 1.5;
  return rating * due;
}

function labelFor(recipe: Recipe, stats: PlanStats | undefined, average: number | undefined, today: string): SuggestionLabel | null {
  if (!stats || stats.times === 0) return "New to try";
  // Well rated and not cooked in a long time: twice its natural gap, and
  // at least two months.
  const long = Math.max(60, 2 * naturalGapDays(recipe.cook_minutes));
  if (average !== undefined && average >= 4 && stats.last && daysBetween(stats.last, today) >= long) return "Forgotten gem";
  return null;
}

export function suggestions({
  recipes,
  stats,
  averages,
  carried,
  inPlan,
  dismissed,
  today,
}: {
  recipes: readonly Recipe[];
  stats: ReadonlyMap<string, PlanStats>;
  averages: ReadonlyMap<string, number>;
  carried: readonly string[];
  inPlan: ReadonlySet<string>;
  dismissed: ReadonlySet<string>;
  today: string;
}): Suggestion[] {
  // Hidden, already in the plan, or dismissed this time: never suggested.
  const open = recipes.filter((recipe) => !recipe.hidden && !inPlan.has(recipe.id) && !dismissed.has(recipe.id));
  const carriedSet = new Set(carried);
  const out: Suggestion[] = open.filter((recipe) => carriedSet.has(recipe.id)).map((recipe) => ({ recipe, label: "Carried over" }));
  const rest = open.filter((recipe) => !carriedSet.has(recipe.id));

  // "Try something new": when nothing new to us was cooked in the last
  // 30 days, one recipe we've never cooked, from a cuisine we haven't
  // cooked in those 30 days either.
  const monthAgo = addDays(today, -30);
  const tried = [...stats.values()].some((stat) => stat.first !== null && stat.first >= monthAgo);
  let fresh: Recipe | undefined;
  if (!tried) {
    const recentCuisines = new Set(
      recipes.filter((recipe) => (stats.get(recipe.id)?.last ?? "") >= monthAgo).map((recipe) => recipe.cuisine),
    );
    fresh = rest
      .filter((recipe) => !stats.get(recipe.id)?.times && recipe.cuisine && !recentCuisines.has(recipe.cuisine))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (fresh) out.push({ recipe: fresh, label: "Try something new" });
  }

  const ranked = rest
    .filter((recipe) => recipe !== fresh)
    .map((recipe) => ({ recipe, score: score(recipe, stats.get(recipe.id), averages.get(recipe.id), today) }))
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, Math.max(0, SUGGESTIONS - out.length));
  for (const { recipe } of ranked) out.push({ recipe, label: labelFor(recipe, stats.get(recipe.id), averages.get(recipe.id), today) });
  return out.slice(0, SUGGESTIONS);
}
