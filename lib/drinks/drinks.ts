import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleStatus } from "../module-status";
import { DRINK_TYPES, fold, grapeSpellings, standardGrape, type DrinkType } from "./lists";

// Drinks (REQ-37, REQ-30, REQ-29): every wine we've had and what each of
// us thought of it.

export type Drink = {
  id: string;
  name: string;
  producer: string | null;
  type: DrinkType | null;
  vintage: number | null;
  non_vintage: boolean;
  grapes: string[];
  region: string | null;
  country: string | null;
  abv: number | null;
  bottle_ml: number | null;
  sweetness: string | null;
  method: string | null;
  disgorged_on: string | null;
  created_at: string;
};

export type Rating = {
  drink_id: string;
  user_id: string;
  stars: number;
  comment: string | null;
  updated_at: string;
};

export type Person = { user_id: string; name: string };

const DRINK_COLUMNS =
  "id, name, producer, type, vintage, non_vintage, grapes, region, country, abv, bottle_ml, sweetness, method, disgorged_on, created_at";

export async function readDrinks(supabase: SupabaseClient): Promise<{ drinks: Drink[]; ratings: Rating[] }> {
  const [drinks, ratings] = await Promise.all([
    supabase.from("drinks").select(DRINK_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("drink_ratings").select("drink_id, user_id, stars, comment, updated_at"),
  ]);
  if (drinks.error) throw new Error(`Could not read Drinks: ${drinks.error.message}`);
  if (ratings.error) throw new Error(`Could not read ratings: ${ratings.error.message}`);
  return {
    drinks: ((drinks.data ?? []) as Drink[]).map((drink) => ({
      ...drink,
      grapes: drink.grapes ?? [],
      abv: drink.abv === null ? null : Number(drink.abv),
    })),
    ratings: (ratings.data ?? []) as Rating[],
  };
}

// The household, by name, for every member's rating (REQ-29). Anyone
// without a name shows the start of their email (household_people does
// that).
export async function readPeople(supabase: SupabaseClient): Promise<Person[]> {
  const { data, error } = await supabase.rpc("household_people");
  if (error) throw new Error(`Could not read the household: ${error.message}`);
  return ((data ?? []) as Person[]).map(({ user_id, name }) => ({ user_id, name }));
}

// "2019", "NV", or nothing.
export function vintageText(drink: Pick<Drink, "vintage" | "non_vintage">): string | null {
  if (drink.non_vintage) return "NV";
  return drink.vintage === null ? null : String(drink.vintage);
}

// What the list says under a drink's name: type · producer · vintage.
export function drinkLine(drink: Drink, typeName: (type: DrinkType) => string): string {
  return [drink.type ? typeName(drink.type) : null, drink.producer, vintageText(drink)]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

// Each person's rating of a drink, in household order; null for anyone
// who hasn't rated it yet, who is shown, never hidden (REQ-29).
export function ratingsFor(drinkId: string, people: readonly Person[], ratings: readonly Rating[]) {
  return people.map((person) => ({
    person,
    rating: ratings.find((row) => row.drink_id === drinkId && row.user_id === person.user_id) ?? null,
  }));
}

export function starsText(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

// REQ-30: a search matches producer, name, grape, region or a rating's
// comment. Accents and case don't matter, and a grape matches under any
// of its names: "shiraz" finds a Syrah.
export function searchDrinks(drinks: readonly Drink[], ratings: readonly Rating[], query: string): Drink[] {
  const words = fold(query);
  if (words === "") return [...drinks];
  const grapeWords = grapeSpellings(query);
  return drinks.filter((drink) => {
    const comments = ratings.filter((row) => row.drink_id === drink.id).map((row) => row.comment ?? "");
    const fields = [drink.name, drink.producer ?? "", drink.region ?? "", ...drink.grapes, ...comments].map(fold);
    if (fields.some((field) => field.includes(words))) return true;
    const grapes = drink.grapes.flatMap((grape) => grapeSpellings(grape));
    return grapes.some((grape) => grapeWords.includes(grape));
  });
}

export function isDrinkType(value: string): value is DrinkType {
  return (DRINK_TYPES as readonly string[]).includes(value);
}

// REQ-30's sort: newest first (the default), oldest first, or by one
// person's rating, highest first, with what they haven't rated last.
export type Sort = { by: "newest" } | { by: "oldest" } | { by: "rating"; userId: string };

export function parseSort(value: string | undefined): Sort {
  if (value === "oldest") return { by: "oldest" };
  if (value?.startsWith("rating:")) return { by: "rating", userId: value.slice("rating:".length) };
  return { by: "newest" };
}

export function sortValue(sort: Sort): string {
  return sort.by === "rating" ? `rating:${sort.userId}` : sort.by;
}

export function listDrinks(
  drinks: readonly Drink[],
  ratings: readonly Rating[],
  { query = "", type = "", sort = { by: "newest" } as Sort }: { query?: string; type?: string; sort?: Sort },
): Drink[] {
  const found = searchDrinks(drinks, ratings, query).filter((drink) => type === "" || drink.type === type);
  const added = (drink: Drink) => Date.parse(drink.created_at);
  if (sort.by === "oldest") return found.sort((a, b) => added(a) - added(b));
  if (sort.by === "newest") return found.sort((a, b) => added(b) - added(a));
  const stars = (drink: Drink) =>
    ratings.find((row) => row.drink_id === drink.id && row.user_id === sort.userId)?.stars ?? 0;
  return found.sort((a, b) => stars(b) - stars(a) || added(b) - added(a));
}

// What a form sends, tidied into a drink's fields (REQ-37): only the name
// is required. Grapes come one per field and are kept as written; the
// lists only match them (REQ-27).
export type DrinkFields = Omit<Drink, "id" | "created_at">;

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const orNull = (value: string) => (value === "" ? null : value);

export function drinkFields(formData: FormData): DrinkFields | { error: string } {
  const name = text(formData, "name");
  if (name === "") return { error: "Give the drink a name." };
  const type = text(formData, "type");
  if (type !== "" && !isDrinkType(type)) return { error: "Choose a type from the list." };

  const vintageRaw = text(formData, "vintage");
  let vintage: number | null = null;
  let non_vintage = false;
  if (/^nv$/i.test(vintageRaw)) non_vintage = true;
  else if (vintageRaw !== "") {
    if (!/^\d{4}$/.test(vintageRaw) || Number(vintageRaw) < 1800 || Number(vintageRaw) > 2200)
      return { error: "Vintage is a year like 2019, or NV." };
    vintage = Number(vintageRaw);
  }

  const abvRaw = text(formData, "abv").replace(/%$/, "").replace(",", ".").trim();
  let abv: number | null = null;
  if (abvRaw !== "") {
    abv = Number(abvRaw);
    if (!Number.isFinite(abv) || abv <= 0 || abv > 100) return { error: "Alcohol is a percentage, like 13.5." };
    abv = Math.round(abv * 10) / 10;
  }

  const sizeRaw = text(formData, "bottle_ml");
  let bottle_ml: number | null = null;
  if (sizeRaw !== "") {
    bottle_ml = Number(sizeRaw);
    if (!Number.isInteger(bottle_ml) || bottle_ml <= 0) return { error: "Bottle size is in millilitres, like 750." };
  }

  const disgorged = text(formData, "disgorged_on");
  if (disgorged !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(disgorged)) return { error: "Disgorged is a date." };

  const grapes = formData
    .getAll("grape")
    .map((grape) => String(grape).trim())
    .filter((grape) => grape !== "");
  // The same grape twice, however spelled, is kept once.
  const unique = grapes.filter(
    (grape, index) => grapes.findIndex((other) => standardGrape(other) === standardGrape(grape)) === index,
  );

  return {
    name,
    producer: orNull(text(formData, "producer")),
    type: type === "" ? null : (type as DrinkType),
    vintage,
    non_vintage,
    grapes: unique,
    region: orNull(text(formData, "region")),
    country: orNull(text(formData, "country")),
    abv,
    bottle_ml,
    sweetness: orNull(text(formData, "sweetness")),
    method: orNull(text(formData, "method")),
    disgorged_on: orNull(disgorged),
  };
}

export async function countDrinks(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase.from("drinks").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not count Drinks: ${error.message}`);
  return count ?? 0;
}

// Home's tile: Drinks raises nothing that needs someone, so it's calm and
// says how many we've recorded.
export function drinksTile(count: number): ModuleStatus {
  const status = count === 0 ? "Nothing recorded yet" : count === 1 ? "1 drink" : `${count} drinks`;
  return { status, headline: status, facts: [], actionItems: [] };
}
