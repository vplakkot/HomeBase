import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveName, boxName, documentsCount, ownerName } from "../../../../lib/paperwork/paperwork";
import { PaperworkScreen, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import band from "../../../../components/band.module.css";

// REQ-153: a storage box's archive, the documents archived on their own
// into that box. It has nothing to manage: it can't be renamed, deleted,
// archived or moved, and it has no category or label.
export default async function ArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const archive = viewer.archives.find((row) => row.id === id);
  if (!archive) notFound();
  const box = viewer.storage.find((entry) => entry.id === archive.storage_entry_id);
  const inside = viewer.papers.filter((paper) => paper.archive_id === archive.id);

  return (
    <PaperworkScreen
      viewer={viewer}
      here={`/paperwork/archives/${archive.id}`}
      query={q}
      crumbs={[
        { name: box ? boxName(box) : "A storage box", href: `/paperwork/boxes/${archive.storage_entry_id}` },
        { name: archiveName(box) },
      ]}
    >
      <div className={styles.fileHead}>
        <div className={styles.section}>
          <h2 className={styles.title}>{archiveName(box)}</h2>
          <p className={styles.facts}>
            <span>{box ? boxName(box) : "A storage box"}</span>
            <span aria-hidden="true">·</span>
            <span>Archived</span>
          </p>
        </div>
      </div>
      {inside.length === 0 ? (
        <p className={styles.empty}>No documents in it.</p>
      ) : (
        <ul className={styles.table} aria-label="Documents in this archive">
          <li className={`${styles.tableHead} ${styles.items}`} aria-hidden="true">
            <span>{documentsCount(inside.length)} in this archive</span>
            <span>Owner</span>
            <span>Dated</span>
            <span>Keep until</span>
          </li>
          {inside.map((paper) => (
            <li key={paper.id}>
              <Link href={`/paperwork/items/${paper.id}`} className={`${styles.row} ${styles.items}`}>
                <span className={`${styles.rowName} ${band.band}`}>{paper.name}</span>
                <span className={styles.rowCell}>{ownerName(paper, viewer.people)}</span>
                <span className={styles.rowCell}>
                  {paper.document_date ? `Dated ${paper.document_date}` : "No date"}
                </span>
                <span className={styles.rowCell}>{paper.keep_until ? `Keep until ${paper.keep_until}` : "Keep"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PaperworkScreen>
  );
}
