import type { Place } from "./places";

// REQ-135: narrowing Want to try or Been to by neighbourhood and cuisine,
// both as Google gives them for each place. Empty means any.
export type PlaceFilter = { area?: string; cuisine?: string };

type Shown = { place: Pick<Place, "neighborhood" | "cuisine"> | null };

const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

// Only what the page's own places have: no option that would show nothing.
export function filterOptions(shown: readonly Shown[]): { areas: string[]; cuisines: string[] } {
  return {
    areas: sorted(shown.flatMap(({ place }) => (place?.neighborhood ? [place.neighborhood] : []))),
    cuisines: sorted(shown.flatMap(({ place }) => (place?.cuisine ? [place.cuisine] : []))),
  };
}

// Places that match every filter set. One Google couldn't answer for
// matches only while no filter is set.
export function applyFilter<T extends Shown>(shown: readonly T[], { area, cuisine }: PlaceFilter): T[] {
  return shown.filter(
    ({ place }) => (!area || place?.neighborhood === area) && (!cuisine || place?.cuisine === cuisine),
  );
}

// The filter from a page's address (?area=…&cuisine=…); anything but a
// single value is ignored.
export function filterFrom(params: Record<string, string | string[] | undefined>): PlaceFilter {
  const one = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);
  return { area: one(params.area), cuisine: one(params.cuisine) };
}
