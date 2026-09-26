import { describe, expect, it } from "vitest";
import {
  drinkFields,
  drinkLine,
  drinksTile,
  listDrinks,
  parseSort,
  ratingsFor,
  searchDrinks,
  starsText,
  vintageText,
  type Drink,
  type Rating,
} from "./drinks";
import { TYPE_NAMES, standardCountry, standardGrape } from "./lists";

// An invented cellar and household; nothing here is real.
const drink = (id: string, name: string, extra: Partial<Drink> = {}): Drink => ({
  id,
  name,
  producer: null,
  type: null,
  vintage: null,
  non_vintage: false,
  grapes: [],
  region: null,
  country: null,
  abv: null,
  bottle_ml: null,
  sweetness: null,
  method: null,
  disgorged_on: null,
  created_at: "2026-09-01T12:00:00Z",
  ...extra,
});

const RIOJA = drink("d1", "Reserva", {
  producer: "Bodega Ficticia",
  type: "red",
  vintage: 2019,
  grapes: ["Tempranillo"],
  region: "Rioja",
  created_at: "2026-09-01T12:00:00Z",
});
const BAROSSA = drink("d2", "Old Vine", {
  producer: "Made-up Estate",
  type: "red",
  vintage: 2021,
  grapes: ["Shiraz"],
  region: "Barossa Valley",
  created_at: "2026-09-10T12:00:00Z",
});
const CREMANT = drink("d3", "Crémant Brut", {
  producer: "Maison Pretend",
  type: "sparkling",
  non_vintage: true,
  grapes: ["Chardonnay", "Pinot Noir"],
  region: "Alsace",
  created_at: "2026-09-20T12:00:00Z",
});
const DRINKS = [RIOJA, BAROSSA, CREMANT];

const rating = (drink_id: string, user_id: string, stars: number, comment: string | null = null): Rating => ({
  drink_id,
  user_id,
  stars,
  comment,
  updated_at: "2026-09-21T12:00:00Z",
});
const RATINGS = [rating("d1", "sam", 4, "great with lamb"), rating("d2", "sam", 5), rating("d2", "alex", 2, "too jammy")];
const PEOPLE = [
  { user_id: "sam", name: "Sam" },
  { user_id: "alex", name: "Alex" },
];

const names = (drinks: Drink[]) => drinks.map((row) => row.name);

describe("the list (REQ-30)", () => {
  it("says type, producer and vintage under a drink's name, and NV for a non-vintage", () => {
    expect(drinkLine(RIOJA, (type) => TYPE_NAMES[type])).toBe("Red · Bodega Ficticia · 2019");
    expect(drinkLine(CREMANT, (type) => TYPE_NAMES[type])).toBe("Sparkling · Maison Pretend · NV");
    expect(drinkLine(drink("d9", "Mystery"), (type) => TYPE_NAMES[type])).toBe("");
  });

  it("shows every household member's rating, and anyone who hasn't rated it as not rated", () => {
    expect(ratingsFor("d1", PEOPLE, RATINGS).map(({ person, rating }) => [person.name, rating?.stars ?? null])).toEqual([
      ["Sam", 4],
      ["Alex", null],
    ]);
    expect(starsText(4)).toBe("★★★★☆");
  });

  it("is newest first by default", () => {
    expect(names(listDrinks(DRINKS, RATINGS, {}))).toEqual(["Crémant Brut", "Old Vine", "Reserva"]);
    expect(names(listDrinks(DRINKS, RATINGS, { sort: parseSort("oldest") }))).toEqual(["Reserva", "Old Vine", "Crémant Brut"]);
  });

  it("sorts by a chosen member's rating, highest first, with what they haven't rated last", () => {
    expect(names(listDrinks(DRINKS, RATINGS, { sort: parseSort("rating:sam") }))).toEqual(["Old Vine", "Reserva", "Crémant Brut"]);
    expect(names(listDrinks(DRINKS, RATINGS, { sort: parseSort("rating:alex") }))).toEqual(["Old Vine", "Crémant Brut", "Reserva"]);
  });

  it("filters by type, sparkling only", () => {
    expect(names(listDrinks(DRINKS, RATINGS, { type: "sparkling" }))).toEqual(["Crémant Brut"]);
    expect(names(listDrinks(DRINKS, RATINGS, { type: "red", sort: parseSort("oldest") }))).toEqual(["Reserva", "Old Vine"]);
  });
});

describe("search (REQ-30)", () => {
  const search = (query: string) => names(searchDrinks(DRINKS, RATINGS, query)).sort();

  it("matches on producer, name, grape, region or a rating's comment", () => {
    expect(search("ficticia")).toEqual(["Reserva"]);
    expect(search("old vine")).toEqual(["Old Vine"]);
    expect(search("tempranillo")).toEqual(["Reserva"]);
    expect(search("alsace")).toEqual(["Crémant Brut"]);
    expect(search("jammy")).toEqual(["Old Vine"]);
  });

  it("ignores case and accents", () => {
    expect(search("CREMANT")).toEqual(["Crémant Brut"]);
  });

  it("finds a grape under any of its names: Syrah finds a Shiraz", () => {
    expect(search("syrah")).toEqual(["Old Vine"]);
    expect(search("spätburgunder")).toEqual(["Crémant Brut"]);
  });

  it("combines with the type filter", () => {
    expect(names(listDrinks(DRINKS, RATINGS, { query: "pinot", type: "red" }))).toEqual([]);
  });
});

describe("the standard lists", () => {
  it("file a grape's other names under its usual one, and keep anything unknown as written", () => {
    expect(standardGrape("shiraz")).toBe("Syrah");
    expect(standardGrape("Garnacha")).toBe("Grenache");
    expect(standardGrape("Madeupgrape ")).toBe("Madeupgrape");
  });

  it("file country spellings together", () => {
    expect(standardCountry("USA")).toBe("United States");
    expect(standardCountry("españa")).toBe("Spain");
  });
});

describe("a drink's fields from the form (REQ-37)", () => {
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
    }
    return data;
  };

  it("needs only a name; everything else is empty", () => {
    expect(drinkFields(form({ name: "  House red " }))).toEqual({
      name: "House red",
      producer: null,
      type: null,
      vintage: null,
      non_vintage: false,
      grapes: [],
      region: null,
      country: null,
      abv: null,
      bottle_ml: null,
      sweetness: null,
      method: null,
      disgorged_on: null,
    });
    expect(drinkFields(form({ name: " " }))).toEqual({ error: "Give the drink a name." });
  });

  it("reads NV and a year, and refuses anything else as a vintage", () => {
    expect(drinkFields(form({ name: "x", vintage: "nv" }))).toMatchObject({ vintage: null, non_vintage: true });
    expect(drinkFields(form({ name: "x", vintage: "2019" }))).toMatchObject({ vintage: 2019, non_vintage: false });
    expect(drinkFields(form({ name: "x", vintage: "19" }))).toEqual({ error: "Vintage is a year like 2019, or NV." });
  });

  it("keeps grapes as written, drops blanks, and keeps the same grape once however it's spelled", () => {
    expect(drinkFields(form({ name: "x", grape: ["Shiraz", "", "syrah", "Viognier"] }))).toMatchObject({
      grapes: ["Shiraz", "Viognier"],
    });
  });

  it("reads alcohol as a percentage and refuses a type that isn't on the list", () => {
    expect(drinkFields(form({ name: "x", abv: "13,5%" }))).toMatchObject({ abv: 13.5 });
    expect(drinkFields(form({ name: "x", abv: "0" }))).toEqual({ error: "Alcohol is a percentage, like 13.5." });
    expect(drinkFields(form({ name: "x", type: "beer" }))).toEqual({ error: "Choose a type from the list." });
  });
});

describe("Home's tile", () => {
  it("is calm and says how many drinks there are", () => {
    expect(drinksTile(0).status).toBe("Nothing recorded yet");
    expect(drinksTile(1).status).toBe("1 drink");
    expect(drinksTile(12)).toMatchObject({ status: "12 drinks", actionItems: [] });
  });

  it("says NV only for a non-vintage", () => {
    expect(vintageText(CREMANT)).toBe("NV");
    expect(vintageText(drink("d9", "x"))).toBeNull();
  });
});
