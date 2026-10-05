import { describe, expect, it } from "vitest";
import { planStats, type PlanRow, type PlanStats } from "./plan";
import type { Recipe } from "./recipes";
import { naturalGapDays, score, suggestions } from "./suggest";

// Invented recipes and plans; nothing here is real.
function recipe(id: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name: `Test ${id}`,
    photo: null,
    hidden: false,
    ai_generated: false,
    created_at: "2026-09-01T12:00:00Z",
    cuisine: "Italian",
    main_meat: null,
    cooking_method: null,
    cook_minutes: 30,
    servings: null,
    ingredients: [],
    steps: [],
    notes: null,
    video_url: null,
    page_url: null,
    ...extra,
  };
}

const TODAY = "2026-09-27";
const planned = (last: string, times = 1, first = last): PlanStats => ({ times, last, first });
const none = new Set<string>();

function suggest(recipes: Recipe[], stats: [string, PlanStats][], extra: Partial<Parameters<typeof suggestions>[0]> = {}) {
  return suggestions({
    recipes,
    stats: new Map(stats),
    averages: new Map(),
    carried: [],
    inPlan: none,
    dismissed: none,
    today: TODAY,
    ...extra,
  });
}
const ids = (list: ReturnType<typeof suggestions>) => list.map((item) => item.recipe.id);

describe("counting what we cooked (REQ-175)", () => {
  const row = (recipe_id: string | null, cooked: boolean, meal_on: string, closed_at: string | null): PlanRow => ({ recipe_id, cooked, meal_on, meal_plans: { closed_at } });
  const CLOSED = "2026-09-26T20:00:00Z";

  it("counts each dish cooked in a closed plan once, on the day it was cooked, with the first and last day", () => {
    const stats = planStats([row("a", true, "2026-09-20", CLOSED), row("a", true, "2026-09-06", "2026-09-12T20:00:00Z"), row("b", true, "2026-09-21", CLOSED)]);
    expect(stats.get("a")).toEqual({ times: 2, last: "2026-09-20", first: "2026-09-06" });
    expect(stats.get("b")).toEqual({ times: 1, last: "2026-09-21", first: "2026-09-21" });
  });

  it("doesn't count a dish marked Didn't cook this, one carried over from before (existing data: cooked is false), or one in a plan still open", () => {
    const stats = planStats([row("a", false, "2026-09-20", CLOSED), row("a", true, "2026-09-06", "2026-09-12T20:00:00Z"), row("c", true, "2026-09-27", null)]);
    expect(stats.get("a")).toEqual({ times: 1, last: "2026-09-06", first: "2026-09-06" });
    expect(stats.has("c")).toBe(false);
  });

  it("counts an evening out toward nothing", () => {
    expect(planStats([row(null, true, "2026-09-20", CLOSED)]).size).toBe(0);
  });
});

describe("suggestions while planning (REQ-117)", () => {
  it("gives a longer natural gap to a longer dish: about monthly at 2 hours, sooner when quick", () => {
    expect(Math.round(naturalGapDays(120))).toBe(30);
    expect(naturalGapDays(20)).toBeLessThan(14);
  });

  it("ranks by rating, days since last cooked and cook time", () => {
    const recipes = [recipe("quick", { cook_minutes: 20 }), recipe("slow", { cook_minutes: 120 }), recipe("meh", { cook_minutes: 20 })];
    // All planned 20 days ago: the quick favourite is due, the 2-hour one isn't yet.
    const stats: [string, PlanStats][] = recipes.map((r) => [r.id, planned("2026-09-07")]);
    const averages = new Map([["quick", 5], ["slow", 5], ["meh", 2]]);
    expect(ids(suggest(recipes, stats, { averages }))).toEqual(["quick", "meh", "slow"]);
  });

  it("works from the whole library each time, so a new recipe doesn't push a favourite out", () => {
    const favourite = recipe("fav", { cook_minutes: 20 });
    const newOnes = Array.from({ length: 8 }, (_, i) => recipe(`new${i}`));
    const list = suggest([favourite, ...newOnes], [["fav", planned("2026-08-20")], ...newOnes.map((r) => [r.id, planned("2026-09-20")] as [string, PlanStats])], {
      averages: new Map([["fav", 5]]),
    });
    expect(ids(list)[0]).toBe("fav");
  });

  it("drops a dismissed suggestion and lets the next one take its place", () => {
    const recipes = Array.from({ length: 7 }, (_, i) => recipe(`r${i}`, { cook_minutes: 20 + i }));
    const stats: [string, PlanStats][] = recipes.map((r) => [r.id, planned("2026-09-01")]);
    const before = ids(suggest(recipes, stats));
    expect(before).toHaveLength(3);
    const after = ids(suggest(recipes, stats, { dismissed: new Set([before[0]]) }));
    expect(after).not.toContain(before[0]);
    expect(after).toHaveLength(3);
    // The two that stayed are still there, and one more took the empty place.
    expect(before.slice(1).every((id) => after.includes(id))).toBe(true);
  });

  it("shows at most 3 in all, even with more carried over (REQ-165)", () => {
    const recipes = Array.from({ length: 6 }, (_, i) => recipe(`c${i}`));
    expect(ids(suggest(recipes, [], { carried: recipes.map((r) => r.id) }))).toHaveLength(3);
  });

  it("labels a well-rated recipe not planned in a long time a Forgotten gem, and a never-planned one New to try", () => {
    const list = suggest([recipe("gem"), recipe("new", { created_at: "2026-09-26T12:00:00Z" })], [["gem", planned("2026-06-01")], ["x", planned("2026-09-20")]], {
      averages: new Map([["gem", 4.5]]),
    });
    expect(list.find((item) => item.recipe.id === "gem")?.label).toBe("Forgotten gem");
    expect(list.find((item) => item.recipe.id === "new")?.label).toBe("New to try");
  });

  it("adds one Try something new when nothing new to us was planned in 30 days: never planned, from a cuisine we haven't had lately", () => {
    const recipes = [
      recipe("pasta", { cuisine: "Italian" }),
      recipe("carbonara", { cuisine: "Italian" }),
      recipe("pho", { cuisine: "Vietnamese" }),
    ];
    const list = suggest(recipes, [["pasta", planned("2026-09-20", 4, "2026-05-01")]]);
    expect(list.filter((item) => item.label === "Try something new").map((item) => item.recipe.id)).toEqual(["pho"]);
    // Something new to us was planned 10 days ago: no Try something new.
    const recent = suggest(recipes, [["pasta", planned("2026-09-17", 1, "2026-09-17")]]);
    expect(recent.some((item) => item.label === "Try something new")).toBe(false);
  });

  it("proposes carried-over recipes first", () => {
    const recipes = [recipe("a"), recipe("b"), recipe("c")];
    const list = suggest(recipes, [], { carried: ["c"] });
    expect(list[0]).toEqual({ recipe: recipes[2], label: "Carried over" });
  });

  it("never suggests a hidden recipe or one already in the plan", () => {
    const recipes = [recipe("a", { hidden: true }), recipe("b"), recipe("c")];
    expect(ids(suggest(recipes, [], { inPlan: new Set(["b"]), carried: ["a"] }))).toEqual(["c"]);
  });
});

describe("the fun numbers on Meal Plans' home (REQ-118)", async () => {
  const { homeStats } = await import("./home");
  it("finds the most planned and top rated recipes, and counts recipes and cuisines, leaving hidden ones out", () => {
    const recipes = [
      recipe("tacos", { cuisine: "Mexican" }),
      recipe("pasta", { cuisine: "Italian" }),
      recipe("pizza", { cuisine: "Italian" }),
      recipe("gone", { cuisine: "Thai", hidden: true }),
    ];
    const result = homeStats(
      recipes,
      new Map([["tacos", planned("2026-09-20", 5)], ["pasta", planned("2026-09-13", 2)], ["gone", planned("2026-01-01", 9)]]),
      new Map([["pasta", 4.5], ["pizza", 4], ["gone", 5]]),
    );
    expect(result.mostCooked).toEqual({ recipe: recipes[0], times: 5 });
    expect(result.topRated).toEqual({ recipe: recipes[1], average: 4.5 });
    expect(result.recipes).toBe(3);
    expect(result.cuisines).toBe(2);
  });

  it("has no favourites before anything is planned or rated", () => {
    expect(homeStats([recipe("a")], new Map(), new Map())).toEqual({ mostCooked: null, topRated: null, recipes: 1, cuisines: 1 });
  });
});

describe("a recipe with no cook time (REQ-174)", () => {
  it("is ranked on rating and days since last cooked alone, with the middling gap, never as a zero-minute dish", () => {
    const last = planned("2026-09-10");
    const none = recipe("none", { cook_minutes: null });
    // The same as a typical 45-minute dish, and not as a dish that takes no time.
    expect(naturalGapDays(null)).toBe(naturalGapDays(45));
    expect(score(none, last, 4, TODAY)).toBe(score(recipe("typical", { cook_minutes: 45 }), last, 4, TODAY));
    expect(score(none, last, 4, TODAY)).not.toBe(score(recipe("instant", { cook_minutes: 0 }), last, 4, TODAY));
    // Two with no cook time rank by rating and recency only.
    const ranked = suggest([recipe("a", { cook_minutes: null }), recipe("b", { cook_minutes: null })], [["a", planned("2026-08-01")], ["b", planned("2026-09-20")]]);
    expect(ids(ranked)[0]).toBe("a");
  });
});

