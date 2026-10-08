import { notFound } from "next/navigation";
import { PetProfile } from "../profile";
import { petsViewer } from "../frame";

// One pet's profile (REQ-186 to REQ-189); the screen itself is in profile.tsx.
export default async function PetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await petsViewer();
  const pet = viewer.pets.find((row) => row.id === id);
  if (!pet) notFound();
  return <PetProfile viewer={viewer} pet={pet} />;
}
