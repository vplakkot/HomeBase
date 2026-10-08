import { OVERVIEW } from "../../components/module-frame";
import { active } from "../../lib/pets/pets";
import { PetCards, PetsScreen, petsViewer } from "./frame";

// The Pets home (REQ-186): one card per active pet, each showing the food
// it's on. Any member sees them all.
export default async function PetsPage() {
  const viewer = await petsViewer();
  return (
    <PetsScreen viewer={viewer} section={OVERVIEW}>
      <PetCards viewer={viewer} pets={active(viewer.pets)} none="No pets yet. Add pet to start a profile." />
    </PetsScreen>
  );
}
