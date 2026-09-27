import { describe, expect, it } from "vitest";
import { carriedOver, planStats, type PlanRow, type PlanStats } from "./plan";
import type { Recipe } from "./recipes";
import { naturalGapDays, suggestions } from "./suggest";

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

describe("closing a week: what carries over (REQ-116)", () => {
  const row = (recipe_id: string, carry_over: boolean, starts_on: string, closed_at: string | null): PlanRow => ({
    plan_id: `plan-${starts_on}`,
    recipe_id,
    carry_over,
    meal_plans: { starts_on, closed_at },
  });

  it("proposes what the last plan closed carried over, not older plans' carry-overs, even when the last one was empty", () => {
    const rows = [
      row("old", true, "2026-09-13", "2026-09-19T20:00:00Z"),
      row("a", true, "2026-09-20", "2026-09-26T20:00:00Z"),
      row("b", false, "2026-09-20", "2026-09-26T20:00:00Z"),
      row("c", false, "2026-09-27", null),
    ];
    expect(carriedOver(rows, "plan-2026-09-20")).toEqual(["a"]);
    // The last plan closed had no recipes at all: nothing is carried over.
    expect(carriedOver(rows, "plan-2026-09-25")).toEqual([]);
  });

  it("doesn't count a carried-over recipe as planned that week", () => {
    const stats = planStats([row("a", true, "2026-09-20", "2026-09-26T20:00:00Z"), row("a", false, "2026-09-06", "2026-09-12T20:00:00Z")]);
    expect(stats.get("a")).toEqual({ times: 1, last: "2026-09-06", first: "2026-09-06" });
  });
});

describe("suggestions while planning (REQ-117)", () => {
  it("gives a longer natural gap to a longer dish: about monthly at 2 hours, sooner when quick", () => {
    expect(Math.round(naturalGapDays(120))).toBe(30);
    expect(naturalGapDays(20)).toBeLessThan(14);
  });

  it("ranks by rating, days since last planned and cook time", () => {
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
    expect(before).toHaveLength(5);
    const after = ids(suggest(recipes, stats, { dismissed: new Set([before[0]]) }));
    expect(after).not.toContain(before[0]);
    expect(after).toHaveLength(5);
    expect(after).toContain("r5");
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
    expect(result.mostPlanned).toEqual({ recipe: recipes[0], times: 5 });
    expect(result.topRated).toEqual({ recipe: recipes[1], average: 4.5 });
    expect(result.recipes).toBe(3);
    expect(result.cuisines).toBe(2);
  });

  it("has no favourites before anything is planned or rated", () => {
    expect(homeStats([recipe("a")], new Map(), new Map())).toEqual({ mostPlanned: null, topRated: null, recipes: 1, cuisines: 1 });
  });
});
