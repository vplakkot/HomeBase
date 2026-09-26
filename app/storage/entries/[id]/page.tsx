import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "../../../../components/icons";
import { documentsCount, fileId } from "../../../../lib/paperwork/paperwork";
import { contentLines, entryId } from "../../../../lib/storage/storage";
import { StorageScreen, filesArchived, storageViewer } from "../../frame";
import { ManageEntry } from "../../sheets";
import styles from "../../storage.module.css";

// One entry (REQ-87, REQ-107): ID · name, with "Box" after a box; what's
// in it, one item per line; its note; and the paperwork files archived
// in it (REQ-98), each opening in Paperwork. Changing it is behind
// Manage; nothing is edited here directly.
export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await storageViewer();
  const entry = viewer.entries.find((row) => row.id === id);
  if (!entry) notFound();
  const label = entryId(entry);
  const lines = contentLines(entry);
  const archived = viewer.files.filter((file) => file.storage_entry_id === entry.id);

  return (
    <StorageScreen viewer={viewer} here={`/storage/entries/${entry.id}`} query={q} crumb={label}>
      <div className={styles.fileHead}>
        <h2 className={styles.title}>
          {label} · {entry.name}
          {entry.is_box ? <sup className={styles.mark}>Box</sup> : null}
        </h2>
        <div className={styles.fileButtons}>
          <ManageEntry entry={entry} label={label} />
        </div>
      </div>
      <div className={styles.pair}>
        <section className={styles.card} aria-label={entry.is_box ? "Contents and note" : "Note"}>
          {entry.is_box ? (
            <>
              <h3 className={styles.cardLabel}>Contents</h3>
              {lines.length === 0 ? (
                <p className={styles.empty}>Nothing listed yet.</p>
              ) : (
                <ul className={styles.lines} aria-label="Contents">
                  {lines.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
          <h3 className={styles.cardLabel}>Note</h3>
          {entry.note ? <p>{entry.note}</p> : <p className={styles.note}>No note</p>}
        </section>
        {archived.length > 0 ? (
          <section className={`${styles.card} ${styles.rows}`} aria-labelledby="archived">
            <h3 id="archived" className={`${styles.cardLabel} ${styles.cardHead}`}>
              {filesArchived(archived.length)}
            </h3>
            <ul className={styles.rows}>
              {archived.map((file) => (
                <li key={file.id}>
                  <Link href={`/paperwork/files/${file.id}`} className={styles.fileRow}>
                    <span className={styles.fileName}>
                      <span className={styles.fileId}>{fileId(file)}</span>
                      {file.label ? file.label : <span className={styles.noLabel}>No label</span>}
                    </span>
                    <span className={styles.cardDetail}>
                      {documentsCount(viewer.papers.filter((paper) => paper.file_id === file.id).length)}
                    </span>
                    <ChevronRightIcon />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </StorageScreen>
  );
}
