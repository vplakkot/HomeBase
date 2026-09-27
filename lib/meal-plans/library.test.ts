import { describe, expect, it } from "vitest";
import { libraryRecipes } from "./library";
import type { Recipe } from "./recipes";

// Invented recipes; nothing here is real.
function recipe(id: string, name: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    photo: null,
    hidden: false,
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
  ["a", { times: 1, last: "2026-09-20" }],
  ["c", { times: 3, last: "2026-09-13" }],
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

  it("leaves hidden recipes out, and lists them on their own", () => {
    expect(names({})).not.toContain("Test soup");
    expect(names({ hidden: "yes" })).toEqual(["Test soup"]);
  });
});
