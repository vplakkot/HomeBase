import { RestaurantsScreen, restaurantsViewer } from "../frame";
import { AddPlaceForm } from "../add-form";

// Add place (REQ-90, REQ-130, REQ-131): paste a Google Maps, Apple Maps or
// OpenTable link, check it's the right place, save it to Want to try.
export default async function AddPlacePage() {
  const viewer = await restaurantsViewer();
  return (
    <RestaurantsScreen viewer={viewer} section="Add place" crumb="Add place" actions={null}>
      <AddPlaceForm />
    </RestaurantsScreen>
  );
}
