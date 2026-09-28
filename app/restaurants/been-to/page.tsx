import { filterFrom } from "../../../lib/restaurants/filter";
import { placesFromEnv, type Place } from "../../../lib/restaurants/places";
import { beenTo } from "../../../lib/restaurants/restaurants";
import { restaurantsViewer } from "../frame";
import { BeenTo } from "../list";

// Been to (REQ-134); the screen itself is in list.tsx. Like Want to try,
// each place's details are asked of Google now, all at once.
export default async function BeenToPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [viewer, params] = await Promise.all([restaurantsViewer(), searchParams]);
  const places = placesFromEnv();
  const tried = beenTo(viewer.restaurants);
  const details = await Promise.all(
    tried.map(async (row): Promise<Place | null> => {
      if (!places) return null;
      return places.details(row.google_place_id, "tile").catch(() => null);
    }),
  );
  return <BeenTo viewer={viewer} tried={tried.map((row, index) => ({ row, place: details[index] }))} filter={filterFrom(params)} />;
}
