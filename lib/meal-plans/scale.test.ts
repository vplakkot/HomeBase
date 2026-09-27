import { describe, expect, it } from "vitest";
import { formatNumber, isFactor, mainMeatIndex, parseNumber, scaleQuantity, scaleRecipe, scaleStep } from "./scale";

// Invented recipes; nothing here is real.
const INGREDIENTS = [
  { quantity: "2", unit: "lb", item: "chicken thighs", note: "" },
  { quantity: "1 1/2", unit: "cups", item: "rice", note: "" },
  { quantity: "250", unit: "g", item: "yogurt", note: "" },
  { quantity: "2", unit: "", item: "onions", note: "sliced" },
  { quantity: "2-3", unit: "tbsp", item: "oil", note: "" },
  { quantity: "", unit: "", item: "salt", note: "to taste" },
];

describe("reading and writing amounts", () => {
  it("reads whole numbers, decimals, fractions, mixed numbers and fraction signs", () => {
    expect(["2", "1.5", "1/2", "1 1/2", "½", "1½", "1/0", "a pinch"].map(parseNumber)).toEqual([2, 1.5, 0.5, 1.5, 0.5, 1.5, null, null]);
  });

  it("writes kitchen fractions, and whole grams", () => {
    expect([1.5, 1 / 3, 0.75, 2, 2.4, 0.999].map((value) => formatNumber(value))).toEqual(["1 1/2", "1/3", "3/4", "2", "2.4", "1"]);
    expect(formatNumber(312.5, "g")).toBe("313");
  });

  it("scales every number in a quantity, ranges included", () => {
    expect(scaleQuantity("2-3", 2)).toBe("4-6");
    expect(scaleQuantity("1 1/2", 0.5)).toBe("3/4");
    expect(scaleQuantity("", 2)).toBe("");
  });
});

describe("scaling a recipe (REQ-113)", () => {
  it("scales every ingredient's quantity in proportion to the servings", () => {
    const scaled = scaleRecipe({ ingredients: INGREDIENTS, steps: [], servings: 4 }, 6 / 4);
    expect(scaled.ingredients.map((row) => row.quantity)).toEqual(["3", "2 1/4", "375", "3", "3-4 1/2", ""]);
    expect(scaled.servings).toBe(6);
  });

  it("scales the amounts inside steps, and leaves times and temperatures alone", () => {
    const step = "Cook 1 1/2 cups rice in 3 cups water for 20 minutes at 400°F, then stir in 2 onions and 125 g yogurt.";
    expect(scaleStep(step, 2, INGREDIENTS)).toBe(
      "Cook 3 cups rice in 6 cups water for 20 minutes at 400°F, then stir in 4 onions and 250 g yogurt.",
    );
  });

  it("scales everything by the same ratio when the main meat changes", () => {
    const recipe = { main_meat: "Chicken", ingredients: INGREDIENTS, steps: ["Brown the 2 lb chicken."], servings: 4 };
    const meat = mainMeatIndex(recipe);
    expect(meat).toBe(0);
    const scaled = scaleRecipe(recipe, 3 / (parseNumber(INGREDIENTS[meat].quantity) ?? 1));
    expect(scaled.ingredients[0].quantity).toBe("3");
    expect(scaled.ingredients[1].quantity).toBe("2 1/4");
    expect(scaled.steps).toEqual(["Brown the 3 lb chicken."]);
    expect(scaled.servings).toBe(6);
  });

  it("offers no meat to scale by for a vegetarian dish or a meat without a number", () => {
    expect(mainMeatIndex({ main_meat: "Vegetarian", ingredients: INGREDIENTS })).toBe(-1);
    expect(mainMeatIndex({ main_meat: "Beef", ingredients: INGREDIENTS })).toBe(-1);
  });

  it("keeps the ratio sensible", () => {
    expect([1.5, 0, -1, Number.NaN, 21, 1 / 21].map(isFactor)).toEqual([true, false, false, false, false, false]);
  });
});
