import Link from "next/link";
import { documentsCount, labelText, type FileRow } from "../../lib/paperwork/paperwork";
import styles from "./paperwork.module.css";

// REQ-100's second screen: every file in a place as a card, ID ·
// category, its label name (or "No label") and how many documents it
// holds.
export function FileCards({ rows }: { rows: FileRow[] }) {
  return (
    <ul className={styles.grid}>
      {rows.map(({ file, category, count }) => (
        <li key={file.id}>
          <Link href={`/paperwork/files/${file.id}`} className={styles.linkCard}>
            <span className={styles.cardTitle}>{labelText(file, category)}</span>
            {file.label ? <span>{file.label}</span> : <span className={styles.noLabel}>No label</span>}
            <span className={styles.cardDetail}>{documentsCount(count)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
