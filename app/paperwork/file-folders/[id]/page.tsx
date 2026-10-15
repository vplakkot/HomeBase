import Link from "next/link";
import { notFound } from "next/navigation";
import {
  documentsCount,
  driveFileFolderState,
  expectedFolderName,
  fileFolderId,
  labelText,
  ownerName,
  placeOf,
} from "../../../../lib/paperwork/paperwork";
import { boxes } from "../../../../lib/storage/storage";
import { CreatedItForm, DriveStatus, FolderName } from "../../drive-forms";
import { DriveFileFolderBody } from "../../drive-views";
import { PaperworkScreen, paperworkViewer } from "../../frame";
import styles from "../../paperwork.module.css";
import { AddPaperwork, ManageFileFolder } from "../../sheets";
import band from "../../../../components/band.module.css";

// REQ-100's third screen, one File Folder: ID · category, its label name, where
// it is and whether it's archived, then every document in it. Changing the
// File Folder is behind Manage File Folder; nothing is edited here directly.
export default async function FileFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { people, categories, fileFolders, papers, storage, locations, choices } = viewer;
  const fileFolder = fileFolders.find((row) => row.id === id);
  if (!fileFolder) notFound();
  const label = labelText(
    fileFolder,
    categories.find((row) => row.id === fileFolder.category_id),
  );
  const place = placeOf(fileFolder, storage, locations);
  const inside = papers.filter((paper) => paper.file_folder_id === fileFolder.id);
  const archived = fileFolder.status === "archived";

  if (fileFolder.is_drive) {
    const category = categories.find((row) => row.id === fileFolder.category_id);
    const state = driveFileFolderState(fileFolder, viewer.drive);
    return (
      <PaperworkScreen
        viewer={viewer}
        here={`/paperwork/file-folders/${fileFolder.id}`}
        query={q}
        crumbs={[{ name: place.name, href: place.href }, { name: fileFolderId(fileFolder) }]}
      >
        <div className={styles.fileFolderHead}>
          <div className={styles.section}>
            <h2 className={styles.title}>{label}</h2>
            <p className={styles.facts}>
              {fileFolder.label ? <strong>{fileFolder.label}</strong> : <span className={styles.noLabel}>No label</span>}
              <span aria-hidden="true">·</span>
              <span>Google Drive</span>
              <span aria-hidden="true">·</span>
              <span>{archived ? "Archived" : "Active"}</span>
              {state.kind === "linked" ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{documentsCount(state.documents.filter((document) => !document.missing).length)}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className={styles.fileFolderButtons}>
            <ManageFileFolder fileFolder={fileFolder} label={label} boxes={[]} choices={choices} returnTo={place.href} />
          </div>
        </div>
        {viewer.drive.connection ? <DriveStatus syncedAt={viewer.drive.connection.synced_at} /> : null}
        <DriveFileFolderBody viewer={viewer} fileFolder={fileFolder} state={state}>
          <FolderName name={expectedFolderName(fileFolder, category)} />
          <CreatedItForm fileFolder={fileFolder} />
        </DriveFileFolderBody>
      </PaperworkScreen>
    );
  }

  return (
    <PaperworkScreen
      viewer={viewer}
      here={`/paperwork/file-folders/${fileFolder.id}`}
      query={q}
      crumbs={[{ name: place.name, href: place.href }, { name: fileFolderId(fileFolder) }]}
    >
      <div className={styles.fileFolderHead}>
        <div className={styles.section}>
          <h2 className={styles.title}>{label}</h2>
          <p className={styles.facts}>
            {fileFolder.label ? <strong>{fileFolder.label}</strong> : <span className={styles.noLabel}>No label</span>}
            <span aria-hidden="true">·</span>
            <span>{place.name}</span>
            <span aria-hidden="true">·</span>
            <span>{archived ? "Archived" : "Active"}</span>
          </p>
        </div>
        <div className={styles.fileFolderButtons}>
          <AddPaperwork fileFolder={fileFolder} choices={choices} />
          <ManageFileFolder fileFolder={fileFolder} label={label} boxes={boxes(storage)} choices={choices} returnTo={place.href} />
        </div>
      </div>
      {inside.length === 0 ? (
        <p className={styles.empty}>No documents in it yet.</p>
      ) : (
        <ul className={styles.table} aria-label="Documents in this File Folder">
          <li className={`${styles.tableHead} ${styles.items}`} aria-hidden="true">
            <span>{documentsCount(inside.length)} in this File Folder</span>
            <span>Owner</span>
            <span>Dated</span>
            <span>Keep until</span>
          </li>
          {inside.map((paper) => (
            <li key={paper.id}>
              <Link href={`/paperwork/items/${paper.id}`} className={`${styles.row} ${styles.items}`}>
                <span className={`${styles.rowName} ${band.band}`}>{paper.name}</span>
                <span className={styles.rowCell}>{ownerName(paper, people)}</span>
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
