import type { Spot } from "./links";
import type { Place } from "./places";

// Picking the place a link meant from what Google found for its name
// (REQ-130; a Google link without an ID goes the same way). One match is
// confident when Google's name agrees with the link's and, where the link
// gave a spot, the place is right there. Otherwise we offer up to three.

// Close enough to be the same door: a pin can sit on the building's
// middle or its entrance.
const SAME_PLACE_METRES = 150;
const NEARBY_METRES = 1000;
export const MAX_CANDIDATES = 3;

export function metresBetween(a: Spot, b: Spot): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// Lower case, no accents, no punctuation, no "the" or "&". An apostrophe
// joins rather than splits: "Joe's" is one word, not "joe" and "s".
function words(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && word !== "the" && word !== "and");
}

// "Katz's Delicatessen" and "Katz's Deli" agree; "Joe's Pizza" and
// "Joe's Shanghai" don't. The shorter name's words must mostly appear in
// the longer one.
export function sameName(a: string, b: string): boolean {
  const [short, long] = [words(a), words(b)].sort((x, y) => x.length - y.length);
  if (short.length === 0) return false;
  const shared = short.filter((word) => long.some((other) => other === word || other.startsWith(word) || word.startsWith(other)));
  return shared.length / short.length >= 0.6;
}

export type Match = { kind: "one"; place: Place } | { kind: "choose"; places: Place[] } | { kind: "none" };

export function pickMatch(name: string, near: Spot | null, found: readonly Place[]): Match {
  const close = (place: Place) =>
    near === null || (place.location !== null && metresBetween(near, place.location) <= SAME_PLACE_METRES);
  const confident = found.filter((place) => sameName(name, place.name) && close(place));
  if (confident.length === 1) return { kind: "one", place: confident[0] };
  // "Nearby": within a short walk of the link's spot, when it gave one.
  const nearby = found.filter(
    (place) => near === null || (place.location !== null && metresBetween(near, place.location) <= NEARBY_METRES),
  );
  const options = (confident.length > 1 ? confident : nearby).slice(0, MAX_CANDIDATES);
  return options.length === 0 ? { kind: "none" } : { kind: "choose", places: options };
}
