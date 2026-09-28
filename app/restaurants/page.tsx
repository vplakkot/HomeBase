import { placesFromEnv, type Place } from "../../lib/restaurants/places";
import { waitingOn, type Restaurant } from "../../lib/restaurants/restaurants";
import { restaurantsViewer } from "./frame";
import { WantToTry } from "./list";

// Want to try (REQ-129), the module's home, with the go-again question
// above it for any tried place the viewer hasn't answered for (REQ-133);
// the screen itself is in list.tsx. We keep only each place's Google ID
// (REQ-90), so the rest is asked of Google now, all places at once.
export default async function RestaurantsPage() {
  const viewer = await restaurantsViewer();
  const places = placesFromEnv();
  const toTry = viewer.restaurants.filter((row) => row.tried_on === null);
  const waiting = waitingOn(viewer.restaurants, viewer.answers, viewer.userId);
  const lookUp = (rows: Restaurant[]) =>
    Promise.all(
      rows.map(async (row): Promise<Place | null> => {
        if (!places) return null;
        return places.details(row.google_place_id, "tile").catch(() => null);
      }),
    );
  const [toTryDetails, waitingDetails] = await Promise.all([lookUp(toTry), lookUp(waiting)]);
  return (
    <WantToTry
      viewer={viewer}
      toTry={toTry.map((row, index) => ({ row, place: toTryDetails[index] }))}
      waiting={waiting.map((row, index) => ({ row, place: waitingDetails[index] }))}
    />
  );
}
