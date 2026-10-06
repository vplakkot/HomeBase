import Link from "next/link";
import { archiveName, documentsCount, labelText, type ArchiveRow, type FileRow } from "../../lib/paperwork/paperwork";
import type { StorageEntry } from "../../lib/storage/storage";
import styles from "./paperwork.module.css";
import band from "../../components/band.module.css";

// REQ-100's second screen: every file in a place as a card, ID ·
// category, its label name (or "No label") and how many documents it
// holds.
export function FileCards({
  rows,
  archive,
  box,
}: {
  rows: FileRow[];
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
      {rows.map(({ file, category, count }) => (
        <li key={file.id}>
          <Link href={`/paperwork/files/${file.id}`} className={styles.linkCard}>
            <span className={`${styles.cardTitle} ${band.band}`}>{labelText(file, category)}</span>
            {file.label ? <span>{file.label}</span> : <span className={styles.noLabel}>No label</span>}
            <span className={styles.cardDetail}>{documentsCount(count)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
