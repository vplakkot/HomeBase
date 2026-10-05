import { describe, expect, it } from "vitest";
import { NOT_SET, libraryRecipes } from "./library";
import type { Recipe } from "./recipes";

// Invented recipes; nothing here is real.
function recipe(id: string, name: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    photo: null,
    hidden: false,
    ai_generated: false,
    created_at: "2026-09-26T12:00:00Z",
    cuisine: null,
    main_meat: null,
    cooking_method: null,
    cook_minutes: null,
    servings: null,
    ingredients: [],
    steps: [],
    notes: null,
    video_url: null,
    page_url: null,
    ...extra,
  };
}

const RECIPES = [
  recipe("a", "Test tacos", { cuisine: "Mexican", main_meat: "Beef", cooking_method: "Stove top", cook_minutes: 25 }),
  recipe("b", "Test tikka", { cuisine: "Indian", main_meat: "Chicken", cooking_method: "Oven", cook_minutes: 50 }),
  recipe("c", "Test stew", { cuisine: "Indian", main_meat: "Lamb", cooking_method: "Instant Pot", cook_minutes: 90 }),
  recipe("d", "Test soup", { hidden: true }),
];
const STATS = new Map([
  ["a", { times: 1, last: "2026-09-20", first: "2026-09-20" }],
  ["c", { times: 3, last: "2026-09-13", first: "2026-08-30" }],
]);
const names = (query: Parameters<typeof libraryRecipes>[2]) => libraryRecipes(RECIPES, STATS, query).map((row) => row.name);

describe("the recipe library (REQ-114)", () => {
  it("searches by name", () => {
    expect(names({ q: "TIK" })).toEqual(["Test tikka"]);
  });

  it("filters by cuisine, main meat, cooking method and cook time", () => {
    expect(names({ cuisine: "Indian" })).toEqual(["Test stew", "Test tikka"]);
    expect(names({ meat: "Beef" })).toEqual(["Test tacos"]);
    expect(names({ method: "Oven" })).toEqual(["Test tikka"]);
    expect(names({ time: "30" })).toEqual(["Test tacos"]);
    expect(names({ time: "60" })).toEqual(["Test tikka"]);
    expect(names({ time: "long" })).toEqual(["Test stew"]);
    expect(names({ cuisine: "Indian", time: "long" })).toEqual(["Test stew"]);
  });

  it("sorts by last planned and times planned, never-planned last", () => {
    expect(names({ sort: "last" })).toEqual(["Test tacos", "Test stew", "Test tikka"]);
    expect(names({ sort: "times" })).toEqual(["Test stew", "Test tacos", "Test tikka"]);
  });

  it("sorts by our average rating, unrated last", () => {
    const averages = new Map([["b", 4.5], ["c", 3]]);
    expect(libraryRecipes(RECIPES, STATS, { sort: "rating" }, averages).map((row) => row.name)).toEqual(["Test tikka", "Test stew", "Test tacos"]);
  });

  it("leaves hidden recipes out, and lists them on their own", () => {
    expect(names({})).not.toContain("Test soup");
    expect(names({ hidden: "yes" })).toEqual(["Test soup"]);
  });
});

describe('the "Not set" filters (REQ-174)', () => {
  const full = recipe("a", "Test tikka", { cuisine: "Indian", main_meat: "Chicken", cooking_method: "Oven", cook_minutes: 40 });
  const bare = recipe("b", "Test pasta");
  const half = recipe("c", "Test tacos", { cuisine: "Mexican", cook_minutes: 20 });
  const all = [full, bare, half];
  const names = (query: object) => libraryRecipes(all, new Map(), query).map((row) => row.name);

  it("finds the recipes with no cuisine, no main meat, no method or no cook time", () => {
    expect(names({ cuisine: NOT_SET })).toEqual(["Test pasta"]);
    expect(names({ meat: NOT_SET })).toEqual(["Test pasta", "Test tacos"]);
    expect(names({ method: NOT_SET })).toEqual(["Test pasta", "Test tacos"]);
    expect(names({ time: NOT_SET })).toEqual(["Test pasta"]);
  });

  it("combines with the other filters, and a real value still finds only that value", () => {
    expect(names({ meat: NOT_SET, time: "30" })).toEqual(["Test tacos"]);
    expect(names({ cuisine: "Mexican" })).toEqual(["Test tacos"]);
    expect(names({ time: "30" })).toEqual(["Test tacos"]);
  });
});

