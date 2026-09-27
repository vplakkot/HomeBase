import { notFound } from "next/navigation";
import { placesFromEnv } from "../../../lib/restaurants/places";
import { restaurantsViewer } from "../frame";
import { PlaceScreen } from "../place";

// One place (REQ-129); the screen itself is in place.tsx. Its details are
// asked of Google now, the dearer fields included (hours, website).
export default async function RestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, restaurantsViewer()]);
  const row = viewer.restaurants.find((restaurant) => restaurant.id === id);
  if (!row) notFound();
  const places = placesFromEnv();
  const place = places ? await places.details(row.google_place_id, "detail").catch(() => null) : null;
  return <PlaceScreen viewer={viewer} row={row} place={place} />;
}
