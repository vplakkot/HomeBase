import { notFound } from "next/navigation";
import { places, sameLocation } from "../../../../lib/paperwork/paperwork";
import { FileCards, filesCount } from "../../file-cards";
import { PaperworkScreen, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import { NewFile } from "../../sheets";

// REQ-100's second screen for an office location: every file kept there.
// The address carries the location's name, however it was typed.
export default async function LocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ name }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const location = decoded(name);
  const { office } = places(viewer.files, viewer.categories, viewer.papers, viewer.storage);
  const place = office.find((card) => sameLocation(card.name, location));
  if (!place) notFound();

  return (
    <PaperworkScreen viewer={viewer} here={place.href} query={q} crumbs={[{ name: place.name }]}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{place.name}</h2>
        <span className={styles.count}>{filesCount(place.files.length)}</span>
        <NewFile location={place.name} choices={viewer.choices} />
      </div>
      <FileCards rows={place.files} />
    </PaperworkScreen>
  );
}

// The name as typed, whether or not the address still has it escaped.
function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
