import type { Ingredient, Recipe } from "./recipes";

// REQ-113: scaling a recipe is plain arithmetic, no AI. Every amount is
// multiplied by one ratio: new servings over old, or new meat over old.
// Anything that doesn't scale well (salt, whole spices) is fixed by hand.

const FRACTIONS: Record<string, number> = { "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅛": 1 / 8 };
const GLYPH = "[½⅓⅔¼¾⅛]";
// "1 1/2", "1/2", "1½", "1.5", "2", "½"
const NUMBER = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?(?:\\s?${GLYPH})?|${GLYPH})`;
const NUMBER_RE = new RegExp(NUMBER, "g");

// Units a step's number can be followed by for it to count as an amount.
// "Bake 20 minutes at 400°F" has no unit after its numbers, so it stays.
const UNITS = [
  "cups?", "tbsps?", "tablespoons?", "tsps?", "teaspoons?", "lbs?", "pounds?", "oz", "ounces?", "g", "grams?", "kg",
  "ml", "l", "liters?", "litres?", "cloves?", "cans?", "sticks?", "bunch(?:es)?", "slices?", "pieces?", "box(?:es)?",
  "packets?", "packs?", "handfuls?", "pinch(?:es)?", "sprigs?", "jars?", "bottles?",
];

// Grams and millilitres read best as whole numbers; cups and spoons as fractions.
const WHOLE_UNITS = /^(g|grams?|ml)$/i;

export function parseNumber(text: string): number | null {
  const value = text.trim();
  const glyph = value.match(new RegExp(`^(\\d*)\\s?(${GLYPH})$`));
  if (glyph) return (glyph[1] ? Number(glyph[1]) : 0) + FRACTIONS[glyph[2]];
  const mixed = value.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[3]) === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}

const NEAT = [0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
const NEAT_TEXT = ["", "1/8", "1/4", "1/3", "1/2", "2/3", "3/4", ""];

// 1.5 → "1 1/2", 0.333 → "1/3", 2.4 → "2.4", 312.5 g → "313"
export function formatNumber(value: number, unit = ""): string {
  if (WHOLE_UNITS.test(unit.trim())) return String(Math.max(1, Math.round(value)));
  let whole = Math.floor(value);
  const rest = value - whole;
  const index = NEAT.findIndex((neat) => Math.abs(rest - neat) < 0.02);
  if (index === -1) return String(Math.round(value * 100) / 100);
  if (index === NEAT.length - 1) whole += 1;
  const part = NEAT_TEXT[index];
  if (whole === 0) return part || "0";
  return part ? `${whole} ${part}` : String(whole);
}

// Every number in a quantity: "2", "1 1/2", "2-3".
export function scaleQuantity(quantity: string, factor: number, unit = ""): string {
  if (factor === 1) return quantity;
  return quantity.replace(NUMBER_RE, (match) => {
    const value = parseNumber(match);
    return value === null ? match : formatNumber(value * factor, unit);
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A step's amounts: a number (or range) followed by a unit, or by the
// first word of an ingredient ("2 onions"). Other numbers stay as written.
export function scaleStep(step: string, factor: number, ingredients: readonly Ingredient[]): string {
  if (factor === 1) return step;
  const words = new Set(UNITS);
  for (const ingredient of ingredients) {
    if (ingredient.unit) words.add(escape(ingredient.unit.toLowerCase()));
    const first = ingredient.item.toLowerCase().match(/^[a-z]{3,}/)?.[0];
    if (first) words.add(`${escape(first)}[a-z]*`);
  }
  const amount = new RegExp(`(${NUMBER}(?:\\s*[-–]\\s*${NUMBER})?)(\\s*)((?:${[...words].join("|")})(?![a-z]))`, "gi");
  return step.replace(amount, (_match, numbers: string, space: string, unit: string) => `${scaleQuantity(numbers, factor, unit)}${space}${unit}`);
}

// The ingredient that is the recipe's main meat, if its amount is a single
// number: "2 lb chicken thighs" for Chicken.
export function mainMeatIndex(recipe: Pick<Recipe, "main_meat" | "ingredients">): number {
  const meat = recipe.main_meat?.toLowerCase();
  if (!meat || meat === "vegetarian") return -1;
  return recipe.ingredients.findIndex((ingredient) => ingredient.item.toLowerCase().includes(meat) && parseNumber(ingredient.quantity) !== null);
}

// The largest change the Scale box allows either way.
export const MAX_FACTOR = 20;

export function isFactor(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_FACTOR && value >= 1 / MAX_FACTOR;
}

export function scaleRecipe(recipe: Pick<Recipe, "ingredients" | "steps" | "servings">, factor: number) {
  return {
    ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient, quantity: scaleQuantity(ingredient.quantity, factor, ingredient.unit) })),
    steps: recipe.steps.map((step) => scaleStep(step, factor, recipe.ingredients)),
    servings: recipe.servings ? Math.max(1, Math.round(recipe.servings * factor)) : null,
  };
}
