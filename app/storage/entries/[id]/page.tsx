import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "../../../../components/icons";
import { archiveName, documentsCount, fileFolderId } from "../../../../lib/paperwork/paperwork";
import { contentLines, entryId } from "../../../../lib/storage/storage";
import { StorageScreen, fileFoldersArchived, storageViewer } from "../../frame";
import { ManageEntry } from "../../sheets";
import styles from "../../storage.module.css";
import band from "../../../../components/band.module.css";

// One entry (REQ-87, REQ-107): ID · name, with "Box" after a box; what's
// in it, one item per line; its note; and the paperwork File Folders archived
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
  const archived = viewer.fileFolders.filter((fileFolder) => fileFolder.storage_entry_id === entry.id);
  const archive = viewer.archives.find((row) => row.storage_entry_id === entry.id);
  const fileFoldersAndArchive = archived.length + (archive ? 1 : 0);

  return (
    <StorageScreen viewer={viewer} here={`/storage/entries/${entry.id}`} query={q} crumb={label}>
      <div className={styles.fileFolderHead}>
        <h2 className={styles.title}>
          {label} · {entry.name}
          {entry.is_box ? <sup className={styles.mark}>Box</sup> : null}
        </h2>
        <div className={styles.fileFolderButtons}>
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
        {fileFoldersAndArchive > 0 ? (
          <section className={`${styles.card} ${styles.rows}`} aria-labelledby="archived">
            <h3 id="archived" className={`${styles.cardLabel} ${styles.cardHead}`}>
              {fileFoldersArchived(fileFoldersAndArchive)}
            </h3>
            <ul className={styles.rows}>
              {archive ? (
                <li>
                  <Link href={`/paperwork/archives/${archive.id}`} className={styles.fileFolderRow}>
                    <span className={`${styles.fileFolderName} ${band.band}`}>
                      {archiveName(entry)}
                    </span>
                    <span className={styles.cardDetail}>
                      {documentsCount(viewer.papers.filter((paper) => paper.archive_id === archive.id).length)}
                    </span>
                    <ChevronRightIcon />
                  </Link>
                </li>
              ) : null}
              {archived.map((fileFolder) => (
                <li key={fileFolder.id}>
                  <Link href={`/paperwork/file-folders/${fileFolder.id}`} className={styles.fileFolderRow}>
                    <span className={`${styles.fileFolderName} ${band.band}`}>
                      <span className={styles.fileFolderId}>{fileFolderId(fileFolder)}</span>
                      {fileFolder.label ? fileFolder.label : <span className={styles.noLabel}>No label</span>}
                    </span>
                    <span className={styles.cardDetail}>
                      {documentsCount(viewer.papers.filter((paper) => paper.file_folder_id === fileFolder.id).length)}
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
