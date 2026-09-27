import { placesFromEnv, type Place } from "../../lib/restaurants/places";
import { restaurantsViewer } from "./frame";
import { WantToTry } from "./list";

// Want to try (REQ-129), the module's home; the screen itself is in
// list.tsx. We keep only each place's Google ID (REQ-90), so the rest is
// asked of Google now, all places at once.
export default async function RestaurantsPage() {
  const viewer = await restaurantsViewer();
  const places = placesFromEnv();
  const details = await Promise.all(
    viewer.restaurants.map(async (row): Promise<Place | null> => {
      if (!places) return null;
      return places.details(row.google_place_id, "tile").catch(() => null);
    }),
  );
  return <WantToTry viewer={viewer} details={details} />;
}
