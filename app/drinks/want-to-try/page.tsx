import { drinksViewer } from "../frame";
import { DrinksHome } from "../home";

// REQ-36: the wines we want to try, kept out of the main list. Same
// search, type filter and sort as the list.
export default async function WantToTryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; sort?: string }>;
}) {
  const [viewer, params] = await Promise.all([drinksViewer(), searchParams]);
  return <DrinksHome viewer={viewer} wanted {...params} />;
}
