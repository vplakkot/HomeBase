import { drinksViewer } from "../frame";
import { DrinksList } from "../list";

// REQ-121: the full list of our wines, a section of its own.
export default async function WinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; sort?: string }>;
}) {
  const [viewer, params] = await Promise.all([drinksViewer(), searchParams]);
  return <DrinksList viewer={viewer} {...params} />;
}
