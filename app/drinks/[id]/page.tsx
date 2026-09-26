import { notFound } from "next/navigation";
import { DrinkScreen } from "../drink";
import { signedPhotoLinks } from "../../../lib/drinks/photos";
import { drinksViewer } from "../frame";

// One drink (REQ-29, REQ-37); the screen itself is in drink.tsx.
export default async function DrinkPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, drinksViewer()]);
  const drink = viewer.drinks.find((row) => row.id === id);
  if (!drink) notFound();
  // REQ-32: the full label photos, as short-lived private links.
  const links = await signedPhotoLinks(
    viewer.supabase,
    [drink.front_label, drink.back_label].filter((path): path is string => !!path),
  );
  return <DrinkScreen viewer={viewer} drink={drink} links={links} />;
}
