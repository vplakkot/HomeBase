import { redirect } from "next/navigation";
import { drinksViewer } from "./frame";
import { DrinksOverview } from "./overview";

// Drinks' home (REQ-120); the screen itself is in overview.tsx. A link
// kept from when the list lived here goes on to Wines with its search.
export default async function DrinksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = new URLSearchParams(await searchParams);
  if (params.size > 0) redirect(`/drinks/wines?${params}`);
  return <DrinksOverview viewer={await drinksViewer()} />;
}
