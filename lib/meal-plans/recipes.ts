import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleStatus } from "../module-status";

// A recipe card (REQ-110): what it holds, the fixed lists it draws from,
// and turning the review form back into a row.

// REQ-110: one cooking method per recipe, from these four. A dish that
// works in both the oven and the air fryer is Air fryer.
export const COOKING_METHODS = ["Stove top", "Air fryer", "Instant Pot", "Oven"] as const;
export type CookingMethod = (typeof COOKING_METHODS)[number];

// REQ-110: one main meat per recipe; a dish with two uses the main one.
export const MAIN_MEATS = ["Chicken", "Beef", "Lamb", "Pork", "Turkey", "Fish", "Shrimp", "Vegetarian"] as const;

export type Ingredient = { quantity: string; unit: string; item: string; note: string };

export type RecipeFields = {
  name: string;
  cuisine: string | null;
  main_meat: string | null;
  cooking_method: CookingMethod | null;
  cook_minutes: number | null;
  servings: number | null;
  ingredients: Ingredient[];
  steps: string[];
  notes: string | null;
  video_url: string | null;
  page_url: string | null;
};

// REQ-114: a hidden recipe leaves the library but is kept.
export type Recipe = RecipeFields & {
  id: string;
  photo: string | null;
  hidden: boolean;
  // REQ-110: Gemini wrote it from the name alone; cleared by any edit.
  ai_generated: boolean;
  created_at: string;
};

// REQ-110: a card with no ingredients and no steps has no recipe yet.
export function recipeMissing(recipe: Pick<Recipe, "ingredients" | "steps">): boolean {
  return recipe.ingredients.length === 0 && recipe.steps.length === 0;
}

// What Gemini hands back, before anyone has reviewed it. `guessed` names
// the fields it filled without being told (REQ-111: marked for review).
export type RecipeDraft = Omit<RecipeFields, "video_url" | "page_url"> & { guessed: string[] };

export type ImportStatus = "uploading" | "processing" | "ready" | "failed";

export type RecipeImport = {
  id: string;
  name: string;
  video_url: string | null;
  // REQ-112: the recipe page it was read from, the "Recipe missing" card
  // it fills in, and whether Gemini wrote it from the name alone.
  page_url: string | null;
  recipe_id: string | null;
  ai_generated: boolean;
  status: ImportStatus;
  draft: RecipeDraft | null;
  error: string | null;
  photo: string | null;
  seen: boolean;
  created_at: string;
  updated_at: string;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const orNull = (value: unknown): string | null => text(value) || null;

function positiveInt(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseInt(text(value), 10);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function isCookingMethod(value: unknown): value is CookingMethod {
  return COOKING_METHODS.includes(value as CookingMethod);
}

// REQ-110: the database keeps a cuisine to 40 characters.
export const MAX_CUISINE = 40;

// Only http(s) links are kept: the card opens them.
export function linkOrNull(value: unknown): string | null {
  const link = text(value);
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function ingredientFrom(value: unknown): Ingredient | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const item = text(row.item);
  if (!item) return null;
  return { quantity: text(row.quantity), unit: text(row.unit), item, note: text(row.note) };
}

// Gemini's answer, checked field by field: anything missing or out of
// place becomes empty rather than breaking the review screen. Null when
// there's no recipe in it at all, so the app says so instead of showing
// an empty card (REQ-112: never invent one in its place).
export function draftFrom(value: unknown): RecipeDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.found === false) return null;
  const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients.map(ingredientFrom).filter((row) => row !== null) : [];
  const steps = Array.isArray(raw.steps) ? raw.steps.map(text).filter(Boolean) : [];
  if (ingredients.length === 0 && steps.length === 0) return null;
  const guessed = Array.isArray(raw.guessed) ? raw.guessed.map(text).filter(Boolean) : [];
  return {
    name: text(raw.name),
    cuisine: orNull(raw.cuisine),
    main_meat: orNull(raw.main_meat),
    cooking_method: isCookingMethod(raw.cooking_method) ? raw.cooking_method : null,
    cook_minutes: positiveInt(raw.cook_minutes),
    servings: positiveInt(raw.servings),
    ingredients,
    steps,
    notes: orNull(raw.notes),
    guessed,
  };
}

// The review and edit form, as a row. Ingredients come as parallel lists
// (quantity, unit, item, note per row); a row without an item is dropped.
export function recipeFieldsFrom(formData: FormData): RecipeFields | { error: string } {
  const name = text(formData.get("name"));
  if (!name) return { error: "Give the recipe a name." };
  const all = (key: string) => formData.getAll(key).map(text);
  const quantities = all("quantity");
  const units = all("unit");
  const notes = all("note");
  const ingredients = all("item").flatMap((item, index) =>
    item ? [{ quantity: quantities[index] ?? "", unit: units[index] ?? "", item, note: notes[index] ?? "" }] : [],
  );
  const method = text(formData.get("cooking_method"));
  const videoText = text(formData.get("video_url"));
  const pageText = text(formData.get("page_url"));
  const video_url = linkOrNull(videoText);
  const page_url = linkOrNull(pageText);
  if (videoText && !video_url) return { error: "The video link should start with https://." };
  if (pageText && !page_url) return { error: "The recipe page link should start with https://." };
  if (text(formData.get("cuisine")).length > MAX_CUISINE) return { error: `Keep the cuisine to ${MAX_CUISINE} letters or fewer.` };
  return {
    name,
    cuisine: orNull(formData.get("cuisine")),
    main_meat: orNull(formData.get("main_meat")),
    cooking_method: isCookingMethod(method) ? method : null,
    cook_minutes: positiveInt(formData.get("cook_minutes")),
    servings: positiveInt(formData.get("servings")),
    ingredients,
    // One step per line.
    steps: text(formData.get("steps"))
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
      .filter(Boolean),
    notes: orNull(formData.get("notes")),
    video_url,
    page_url,
  };
}

// "1 tsp cumin (toasted)"
export function ingredientText(ingredient: Ingredient): string {
  const amount = [ingredient.quantity, ingredient.unit].filter(Boolean).join(" ");
  return `${amount ? `${amount} ` : ""}${ingredient.item}${ingredient.note ? ` (${ingredient.note})` : ""}`;
}

export function cookTimeText(minutes: number | null): string | null {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const RECIPE_COLUMNS =
  "id, name, photo, video_url, page_url, cuisine, main_meat, cooking_method, cook_minutes, servings, ingredients, steps, notes, hidden, ai_generated, created_at";

export async function readRecipes(supabase: SupabaseClient): Promise<Recipe[]> {
  const { data, error } = await supabase.from("recipes").select(RECIPE_COLUMNS).order("name");
  if (error) throw new Error(`Could not read recipes: ${error.message}`);
  return (data ?? []) as Recipe[];
}

export async function readRecipe(supabase: SupabaseClient, id: string): Promise<Recipe | null> {
  const { data, error } = await supabase.from("recipes").select(RECIPE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the recipe: ${error.message}`);
  return (data as Recipe | null) ?? null;
}

export async function readCuisines(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("cuisines").select("name").order("name");
  if (error) throw new Error(`Could not read cuisines: ${error.message}`);
  return (data ?? []).map((row: { name: string }) => row.name);
}

const IMPORT_COLUMNS = "id, name, video_url, page_url, recipe_id, ai_generated, status, draft, error, photo, seen, created_at, updated_at";

// The signed-in person's imports (the table only shows each person theirs).
export async function readImports(supabase: SupabaseClient): Promise<RecipeImport[]> {
  const { data, error } = await supabase.from("recipe_imports").select(IMPORT_COLUMNS).order("created_at", { ascending: false });
  if (error) throw new Error(`Could not read recipe imports: ${error.message}`);
  return (data ?? []) as RecipeImport[];
}

export async function readImport(supabase: SupabaseClient, id: string): Promise<RecipeImport | null> {
  const { data, error } = await supabase.from("recipe_imports").select(IMPORT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the recipe import: ${error.message}`);
  return (data as RecipeImport | null) ?? null;
}

export async function countRecipes(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase.from("recipes").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not count recipes: ${error.message}`);
  return count ?? 0;
}

// Home's tile: calm, and says how many recipes we keep.
export function recipesTile(count: number): ModuleStatus {
  const status = count === 0 ? "No recipes yet" : count === 1 ? "1 recipe" : `${count} recipes`;
  return { status, headline: status, facts: [], actionItems: [] };
}
