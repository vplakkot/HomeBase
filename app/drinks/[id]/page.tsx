import { notFound } from "next/navigation";
import { DrinkScreen } from "../drink";
import { drinksViewer } from "../frame";

// One drink (REQ-29, REQ-37); the screen itself is in drink.tsx.
export default async function DrinkPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, drinksViewer()]);
  const drink = viewer.drinks.find((row) => row.id === id);
  if (!drink) notFound();
  return <DrinkScreen viewer={viewer} drink={drink} />;
}
