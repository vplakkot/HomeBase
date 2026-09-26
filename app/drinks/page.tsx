import { DrinksHome } from "./home";
import { drinksViewer } from "./frame";

// Drinks' home (REQ-30); the screen itself is in home.tsx.
export default async function DrinksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; sort?: string }>;
}) {
  const [viewer, params] = await Promise.all([drinksViewer(), searchParams]);
  return <DrinksHome viewer={viewer} {...params} />;
}
