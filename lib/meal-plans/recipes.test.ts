import { describe, expect, it } from "vitest";
import { cookTimeText, draftFrom, ingredientText, recipeFieldsFrom, recipesTile } from "./recipes";

function form(fields: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of fields) data.append(key, value);
  return data;
}

describe("Gemini's draft, checked (REQ-110, REQ-112)", () => {
  it("keeps a full card and the fields it guessed", () => {
    const draft = draftFrom({
      found: true,
      name: "Test pasta",
      cuisine: "Turkish",
      main_meat: "Beef",
      cooking_method: "Stove top",
      cook_minutes: 25,
      servings: 4,
      ingredients: [{ quantity: "1", unit: "box", item: "pasta" }, { item: "" }],
      steps: ["Boil 1 box pasta.", "  "],
      guessed: ["cuisine", "cook_minutes"],
    });
    expect(draft).toEqual({
      name: "Test pasta",
      cuisine: "Turkish",
      main_meat: "Beef",
      cooking_method: "Stove top",
      cook_minutes: 25,
      servings: 4,
      ingredients: [{ quantity: "1", unit: "box", item: "pasta", note: "" }],
      steps: ["Boil 1 box pasta."],
      notes: null,
      guessed: ["cuisine", "cook_minutes"],
    });
  });

  it("drops a cooking method outside the four (REQ-110)", () => {
    expect(draftFrom({ steps: ["Grill it."], cooking_method: "Grill" })?.cooking_method).toBeNull();
  });

  it("has no draft at all when Gemini found no recipe, rather than an empty card (REQ-112)", () => {
    expect(draftFrom({ found: false, ingredients: [{ item: "x" }], steps: ["y"] })).toBeNull();
    expect(draftFrom({ found: true, ingredients: [], steps: [] })).toBeNull();
    expect(draftFrom("nonsense")).toBeNull();
  });
});

describe("the review form, as a recipe (REQ-110, REQ-111)", () => {
  it("reads ingredients row by row and steps line by line, dropping step numbers", () => {
    const fields = recipeFieldsFrom(
      form([
        ["name", "Test soup"],
        ["quantity", "1"], ["unit", "tsp"], ["item", "cumin"], ["note", "toasted"],
        ["quantity", ""], ["unit", ""], ["item", ""], ["note", ""],
        ["steps", "1. Add 1 tsp cumin.\n\n2) Simmer 10 min."],
        ["cooking_method", "Instant Pot"],
        ["cook_minutes", "90"],
        ["video_url", "https://www.instagram.com/reel/example/"],
      ]),
    );
    expect(fields).toMatchObject({
      name: "Test soup",
      ingredients: [{ quantity: "1", unit: "tsp", item: "cumin", note: "toasted" }],
      steps: ["Add 1 tsp cumin.", "Simmer 10 min."],
      cooking_method: "Instant Pot",
      cook_minutes: 90,
      video_url: "https://www.instagram.com/reel/example/",
      page_url: null,
    });
  });

  it("keeps a cuisine within the list's 40 letters", () => {
    expect(recipeFieldsFrom(form([["name", "x"], ["cuisine", "x".repeat(41)]]))).toEqual({ error: "Keep the cuisine to 40 letters or fewer." });
  });

  it("needs a name, and links that are web links", () => {
    expect(recipeFieldsFrom(form([["name", " "]]))).toEqual({ error: "Give the recipe a name." });
    expect(recipeFieldsFrom(form([["name", "x"], ["video_url", "javascript:alert(1)"]]))).toEqual({
      error: "The video link should start with https://.",
    });
  });
});

describe("how a card reads", () => {
  it("writes an ingredient with its amount and note", () => {
    expect(ingredientText({ quantity: "1", unit: "tsp", item: "cumin", note: "toasted" })).toBe("1 tsp cumin (toasted)");
    expect(ingredientText({ quantity: "", unit: "", item: "salt", note: "" })).toBe("salt");
  });

  it("writes cook time in hours and minutes", () => {
    expect(cookTimeText(25)).toBe("25 min");
    expect(cookTimeText(60)).toBe("1 h");
    expect(cookTimeText(95)).toBe("1 h 35 min");
    expect(cookTimeText(null)).toBeNull();
  });

  it("says on Home how many recipes we keep", () => {
    expect(recipesTile(0).status).toBe("No recipes yet");
    expect(recipesTile(1).status).toBe("1 recipe");
    expect(recipesTile(12).status).toBe("12 recipes");
  });
});
