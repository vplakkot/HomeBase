import { buyAgainText, displayName, ratingsFor, vintageText, type Drink, type DrinkFields, type Person, type Rating } from "./drinks";
import { fold, isGenericName } from "./lists";

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
const words = (...texts: (string | null | undefined)[]) => fold(texts.filter(Boolean).join(" ")).split(" ").filter(Boolean);

// The same wine by name, even when the label reading split it between
// producer and name ("LA" / "SONRIENTE" against a saved "La Sonriente"):
// every word of one side's name is somewhere in the other's producer and
// name. At least one of those words must be a real word (four letters or
// more), so "La" alone never matches.
function sameWine(drink: Drink, read: Partial<DrinkFields>): boolean {
  // A generic name ("Pinot Grigio") is only the same wine from the same
  // producer: the saved wine must have one, and the reading must show it,
  // as its producer or inside its name ("Gaetano D'Aquino Pinot Grigio").
  // What's left of the read name must then be the same grape or region.
  if (isGenericName(drink.name) || isGenericName(read.name ?? "")) {
    if (!drink.producer) return false;
    const producer = words(drink.producer);
    const readProducer = words(read.producer);
    const shown =
      (producer.some((word) => word.length >= 4) && producer.every((word) => words(read.producer, read.name).includes(word))) ||
      (readProducer.some((word) => word.length >= 4) && readProducer.every((word) => producer.includes(word)));
    if (!shown) return false;
    const rest = words(read.name).filter((word) => !producer.includes(word));
    return rest.join(" ") === words(drink.name).join(" ");
  }
  if (same(drink.name, read.name)) return true;
  const within = (name: string[], all: string[]) =>
    name.length > 0 && name.some((word) => word.length >= 4) && name.every((word) => all.includes(word));
  return (
    within(words(drink.name), words(read.producer, read.name)) || within(words(read.name), words(drink.producer, drink.name))
  );
}

function summary(drink: Drink, people: readonly Person[], ratings: readonly Rating[]): Summary {
  return {
    id: drink.id,
    name: displayName(drink),
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
  if (words(read.name).length === 0) return { kind: "unknown" };
  const wine = drinks.filter(
    (drink) =>
      sameWine(drink, read) &&
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
