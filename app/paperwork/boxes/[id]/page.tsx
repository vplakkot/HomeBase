import { notFound } from "next/navigation";
import { places } from "../../../../lib/paperwork/paperwork";
import { FileCards, filesCount } from "../../file-cards";
import { PaperworkScreen, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";

// REQ-100's second screen for a storage box: the paperwork files archived
// in it (REQ-98). The box's own contents live in Storage.
export default async function BoxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { archived } = places(viewer.files, viewer.categories, viewer.papers, viewer.storage);
  const place = archived.find((card) => card.href === `/paperwork/boxes/${id}`);
  if (!place) notFound();

  return (
    <PaperworkScreen viewer={viewer} here={place.href} query={q} crumbs={[{ name: place.name }]}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{place.name}</h2>
        <span className={styles.count}>{filesCount(place.files.length)}</span>
      </div>
      <FileCards rows={place.files} />
    </PaperworkScreen>
  );
}
