import Link from "next/link";
import { archiveName, documentsCount, labelText, type ArchiveRow, type FileFolderRow } from "../../lib/paperwork/paperwork";
import type { StorageEntry } from "../../lib/storage/storage";
import styles from "./paperwork.module.css";
import band from "../../components/band.module.css";

// REQ-100's second screen: every File Folder in a place as a card, ID ·
// category, its label name (or "No label") and how many documents it
// holds.
export function FileFolderCards({
  rows,
  archive,
  box,
}: {
  rows: FileFolderRow[];
  archive?: ArchiveRow | null;
  box?: StorageEntry;
}) {
  return (
    <ul className={styles.grid}>
      {archive ? (
        <li>
          <Link href={`/paperwork/archives/${archive.archive.id}`} className={styles.linkCard}>
            <span className={`${styles.cardTitle} ${band.band}`}>{archiveName(box)}</span>
            <span className={styles.noLabel}>No label</span>
            <span className={styles.cardDetail}>{documentsCount(archive.count)}</span>
          </Link>
        </li>
      ) : null}
      {rows.map(({ fileFolder, category, count }) => (
        <li key={fileFolder.id}>
          <Link href={`/paperwork/file-folders/${fileFolder.id}`} className={styles.linkCard}>
            <span className={`${styles.cardTitle} ${band.band}`}>{labelText(fileFolder, category)}</span>
            {fileFolder.label ? <span>{fileFolder.label}</span> : <span className={styles.noLabel}>No label</span>}
            <span className={styles.cardDetail}>{documentsCount(count)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
