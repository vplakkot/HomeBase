import Link from "next/link";
import { notFound } from "next/navigation";
import { fileId, labelText, ownerName, placeOf } from "../../../../lib/paperwork/paperwork";
import { boxes } from "../../../../lib/storage/storage";
import { PaperworkScreen, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import { AddPaperwork, ManageFile } from "../../sheets";

// REQ-100's third screen, one file: ID · category, its label name, where
// it is and whether it's archived, then every paper in it. Changing the
// file is behind Manage file; nothing is edited here directly.
export default async function FilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { people, categories, files, papers, storage, choices } = viewer;
  const file = files.find((row) => row.id === id);
  if (!file) notFound();
  const label = labelText(file, categories.find((row) => row.id === file.category_id));
  const place = placeOf(file, storage);
  const inside = papers.filter((paper) => paper.file_id === file.id);
  const archived = file.status === "archived";

  return (
    <PaperworkScreen
      viewer={viewer}
      here={`/paperwork/files/${file.id}`}
      query={q}
      crumbs={[{ name: place.name, href: place.href }, { name: fileId(file) }]}
    >
      <div className={styles.fileHead}>
        <div className={styles.group}>
          <h2 className={styles.title}>{label}</h2>
          <p className={styles.facts}>
            {file.label ? <strong>{file.label}</strong> : <span className={styles.noLabel}>No label</span>}
            <span aria-hidden="true">·</span>
            <span>{place.name}</span>
            <span aria-hidden="true">·</span>
            <span className={archived ? `${styles.status} ${styles.archivedStatus}` : styles.status}>
              {archived ? "Archived" : "Active"}
            </span>
          </p>
        </div>
        <div className={styles.fileButtons}>
          <AddPaperwork file={file} choices={choices} />
          <ManageFile file={file} label={label} boxes={boxes(storage)} choices={choices} />
        </div>
      </div>
      {inside.length === 0 ? (
        <p className={styles.empty}>Nothing in it yet.</p>
      ) : (
        <ul className={styles.table} aria-label="Paperwork in this file">
          <li className={`${styles.tableHead} ${styles.items}`} aria-hidden="true">
            <span>{inside.length === 1 ? "1 item in this file" : `${inside.length} items in this file`}</span>
            <span>Owner</span>
            <span>Dated</span>
            <span>Keep until</span>
          </li>
          {inside.map((paper) => (
            <li key={paper.id}>
              <Link href={`/paperwork/items/${paper.id}`} className={`${styles.row} ${styles.items}`}>
                <span className={styles.rowName}>{paper.name}</span>
                <span className={styles.rowCell}>{ownerName(paper, people)}</span>
                <span className={styles.rowCell}>{paper.document_date ? `Dated ${paper.document_date}` : "No date"}</span>
                <span className={styles.rowCell}>{paper.keep_until ? `Keep until ${paper.keep_until}` : "Keep"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PaperworkScreen>
  );
}
