import { buyAgainText, ratingsFor, vintageText, type Drink, type DrinkFields, type Person, type Rating } from "./drinks";
import { fold } from "./lists";

// The shop check (REQ-33): have we had the wine just scanned? It matches
// on producer, wine name and vintage. The same producer and name with a
// different vintage is a near match, shown as one. The answer comes
// straight after reading, before anything is saved.

export type Summary = {
  id: string;
  name: string;
  producer: string | null;
  vintage: string | null;
  wanted: boolean;
  ratings: { name: string; stars: number | null; comment: string | null; buyAgain: string | null }[];
};

export type ShopCheck =
  | { kind: "unknown" }
  | { kind: "new" }
  | { kind: "same"; drinks: Summary[] }
  | { kind: "near"; drinks: Summary[] };

const same = (a: string | null | undefined, b: string | null | undefined) => fold(a ?? "") === fold(b ?? "");

function summary(drink: Drink, people: readonly Person[], ratings: readonly Rating[]): Summary {
  return {
    id: drink.id,
    name: drink.name,
    producer: drink.producer,
    vintage: vintageText(drink),
    wanted: drink.how === "want_to_try",
    ratings: ratingsFor(drink.id, people, ratings).map(({ person, rating }) => ({
      name: person.name,
      stars: rating?.stars ?? null,
      comment: rating?.comment ?? null,
      buyAgain: rating ? buyAgainText(rating.buy_again) : null,
    })),
  };
}

export function shopCheck(
  read: Partial<DrinkFields>,
  drinks: readonly Drink[],
  people: readonly Person[],
  ratings: readonly Rating[],
): ShopCheck {
  // Without a name there's nothing to match on.
  if (!read.name || fold(read.name) === "") return { kind: "unknown" };
  const wine = drinks.filter(
    (drink) =>
      same(drink.name, read.name) &&
      // A producer on only one side doesn't rule a match out; two
      // different producers do.
      (!read.producer || !drink.producer || same(drink.producer, read.producer)),
  );
  const readVintage = vintageText({ vintage: read.vintage ?? null, non_vintage: read.non_vintage ?? false });
  const exact = wine.filter((drink) => vintageText(drink) === readVintage);
  if (exact.length > 0) return { kind: "same", drinks: exact.map((drink) => summary(drink, people, ratings)) };
  if (wine.length > 0) return { kind: "near", drinks: wine.map((drink) => summary(drink, people, ratings)) };
  return { kind: "new" };
}
