import { archived } from "../../../lib/pets/pets";
import { PetCards, PetsScreen, petsViewer } from "../frame";

// Archived profiles (REQ-186): open one read-only, or restore it there.
export default async function ArchivedPetsPage() {
  const viewer = await petsViewer();
  return (
    <PetsScreen viewer={viewer} section="Archived">
      <PetCards viewer={viewer} pets={archived(viewer.pets)} none="No archived pets." />
    </PetsScreen>
  );
}
