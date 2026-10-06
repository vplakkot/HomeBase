import type { ReactNode } from "react";
import { buttonClass } from "../../components/button";
import { ownerGuess } from "../../lib/paperwork/drive-sync";
import type { DriveDocument } from "../../lib/paperwork/drive-sync";
import {
  driveUnfiled,
  expectedFolderName,
  ownerName,
  unlinkedFolders,
  type DriveFileState,
  type PaperFile,
} from "../../lib/paperwork/paperwork";
import { archiveDriveDocument, bringBackDriveDocument, fixFolderName, ignoreFolder, removeMissingDocument } from "./drive-actions";
import { LinkFolderForm } from "./drive-forms";
import { Section, type PaperworkViewer } from "./frame";
import styles from "./paperwork.module.css";
import { FileDriveDocumentButton, SetOwnerButton } from "./sheets";
import band from "../../components/band.module.css";

// What the screens show of Google Drive (REQ-152, REQ-153): documents,
// the unfiled ones, folders nobody has linked, and a File's own folder.

// A document's name, opening it in Google Drive.
function DocumentName({ document }: { document: DriveDocument }) {
  return document.link && !document.missing ? (
    <a href={document.link} target="_blank" rel="noreferrer" className={`${styles.strong} ${band.band}`}>
      {document.name}
    </a>
  ) : (
    <span className={`${styles.strong} ${band.band}`}>{document.name}</span>
  );
}

function ownerText(document: DriveDocument, people: PaperworkViewer["people"]): string {
  return document.owner_set ? ownerName(document, people) : "Owner not set";
}

// The admin's way to clear a document Drive no longer has.
function RemoveRecord({ document, admin }: { document: DriveDocument; admin: boolean }) {
  if (!document.missing) return null;
  return (
    <>
      <span className={styles.missing}>Missing in Drive</span>
      {admin ? (
        <form action={removeMissingDocument} className={styles.inlineForm}>
          <input type="hidden" name="documentId" value={document.drive_id} />
          <button type="submit" className={buttonClass} aria-label={`Remove the record of ${document.name}`}>
            Remove record
          </button>
        </form>
      ) : null}
    </>
  );
}

// Who owns an unfiled document in Drive, if that's a household member.
function inDrive(document: DriveDocument, viewer: PaperworkViewer): string {
  const owner = ownerGuess(document.drive_owner_email, viewer.members);
  return owner ? `Owned by ${ownerName({ owner_id: owner }, viewer.people)} in Drive` : "In Google Drive";
}

const driveFilesToFileInto = (viewer: PaperworkViewer): PaperFile[] =>
  viewer.files.filter((file) => file.is_drive && file.status === "active" && file.drive_folder_id !== null);

// "Unfiled · Google Drive" (REQ-152): loose documents in the connected
// folder, apart from physical Unfiled. Filing one moves it into a Drive
// File and confirms its owner; Archive sends it to the Archived folder.
export function DriveUnfiledSection({ viewer }: { viewer: PaperworkViewer }) {
  if (!viewer.drive.connection) return null;
  const waiting = driveUnfiled(viewer.drive);
  const targets = driveFilesToFileInto(viewer);
  return (
    <Section id="drive-unfiled" title="Unfiled · Google Drive" aside={`${waiting.length} to file`}>
      {waiting.length === 0 ? (
        <p className={styles.empty}>Nothing loose in Google Drive.</p>
      ) : (
        <ul className={`${styles.card} ${styles.rows}`} aria-label="Unfiled Google Drive documents">
          {waiting.map((document) => (
            <li key={document.drive_id} className={styles.itemRow}>
              <span className={styles.itemText}>
                <DocumentName document={document} />
                <span className={styles.note}>
                  {document.missing ? "No longer in Drive" : inDrive(document, viewer)}
                </span>
              </span>
              <span className={styles.rowActions}>
                {document.missing ? (
                  <RemoveRecord document={document} admin={viewer.canManagePaperwork} />
                ) : (
                  <>
                    <FileDriveDocumentButton
                      documentId={document.drive_id}
                      name={document.name}
                      files={targets}
                      choices={viewer.choices}
                      guess={ownerGuess(document.drive_owner_email, viewer.members)}
                    />
                    <form action={archiveDriveDocument} className={styles.inlineForm}>
                      <input type="hidden" name="documentId" value={document.drive_id} />
                      <button type="submit" className={buttonClass} aria-label={`Archive ${document.name}`}>
                        Archive
                      </button>
                    </form>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// REQ-152 "Folder name checks": sub-folders of the connected folder that
// no File is linked to. The admin links one to a File waiting for its
// folder, or ignores it.
export function UnlinkedFoldersSection({ viewer }: { viewer: PaperworkViewer }) {
  if (!viewer.drive.connection || !viewer.canManagePaperwork) return null;
  const folders = unlinkedFolders(viewer.drive, viewer.files);
  if (folders.length === 0) return null;
  const waiting = viewer.files.filter((file) => file.is_drive && file.drive_folder_id === null);
  return (
    <Section id="unlinked-folders" title="Unlinked folders" aside={`${folders.length}`}>
      <ul className={`${styles.card} ${styles.rows}`}>
        {folders.map((folder) => (
          <li key={folder.drive_id} className={styles.itemRow}>
            <span className={styles.itemText}>
              <span className={`${styles.strong} ${band.band}`}>{folder.name}</span>
              <span className={styles.note}>{folder.in_archived ? "In Archived" : "In the connected folder"} · no file is linked to it</span>
            </span>
            <span className={styles.rowActions}>
              <LinkFolderForm folderId={folder.drive_id} files={waiting} categories={viewer.categories} />
              <form action={ignoreFolder} className={styles.inlineForm}>
                <input type="hidden" name="folderId" value={folder.drive_id} />
                <button type="submit" className={buttonClass} aria-label={`Ignore ${folder.name}`}>
                  Ignore
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// A Drive File's screen below its header (REQ-152): waiting for its
// folder, gone from Drive, or its documents, with the name check.
export function DriveFileBody({
  viewer,
  file,
  state,
  children,
}: {
  viewer: PaperworkViewer;
  file: PaperFile;
  state: DriveFileState;
  children?: ReactNode;
}) {
  const category = viewer.categories.find((row) => row.id === file.category_id);
  const expected = expectedFolderName(file, category);
  const targets = driveFilesToFileInto(viewer).filter((row) => row.id !== file.id);

  if (state.kind === "waiting") {
    return (
      <section className={styles.card} aria-label="Waiting for folder">
        <div className={styles.itemRow}>
          <span className={styles.itemText}>
            <span className={`${styles.strong} ${band.band}`}>Waiting for folder</span>
            <span className={styles.note}>
              Make a folder with exactly this name in the connected Google Drive folder, then tell HomeBase.
            </span>
            {children}
          </span>
        </div>
      </section>
    );
  }
  if (state.kind === "missing") {
    return (
      <section className={styles.card} aria-label="Folder missing">
        <div className={styles.itemRow}>
          <span className={styles.itemText}>
            <span className={`${styles.strong} ${band.band}`}>Folder missing in Drive</span>
            <span className={styles.note}>Its folder was deleted or trashed. Remove the file from Manage file, or restore the folder in Drive.</span>
          </span>
        </div>
      </section>
    );
  }
  const off = state.folder.name !== expected;
  return (
    <>
      {off && viewer.canManagePaperwork ? (
        <section className={styles.card} aria-label="Folder name check">
          <div className={styles.itemRow}>
            <span className={styles.itemText}>
              <span className={`${styles.strong} ${band.band}`}>Folder name doesn&apos;t follow convention</span>
              <span className={styles.note}>
                In Drive it&apos;s {state.folder.name}; it should be {expected}.
              </span>
            </span>
            <form action={fixFolderName} className={styles.inlineForm}>
              <input type="hidden" name="id" value={file.id} />
              <button type="submit" className={buttonClass}>
                Fix
              </button>
            </form>
          </div>
        </section>
      ) : null}
      {state.documents.length === 0 ? (
        <p className={styles.empty}>No documents in its folder yet.</p>
      ) : (
        <ul className={`${styles.card} ${styles.rows}`} aria-label="Documents in this file">
          {state.documents.map((document) => (
            <li key={document.drive_id} className={styles.itemRow}>
              <span className={styles.itemText}>
                <DocumentName document={document} />
                {document.missing ? null : <span className={styles.note}>{ownerText(document, viewer.people)}</span>}
              </span>
              <span className={styles.rowActions}>
                {document.missing ? (
                  <RemoveRecord document={document} admin={viewer.canManagePaperwork} />
                ) : (
                  <>
                    {document.owner_set ? null : (
                      <SetOwnerButton
                        documentId={document.drive_id}
                        name={document.name}
                        people={viewer.choices.people}
                        current={ownerGuess(document.drive_owner_email, viewer.members) ?? "joint"}
                      />
                    )}
                    {targets.length > 0 ? (
                      <FileDriveDocumentButton
                        documentId={document.drive_id}
                        name={document.name}
                        files={targets}
                        choices={viewer.choices}
                        guess={document.owner_id}
                        moving
                      />
                    ) : null}
                    <form action={archiveDriveDocument} className={styles.inlineForm}>
                      <input type="hidden" name="documentId" value={document.drive_id} />
                      <button type="submit" className={buttonClass} aria-label={`Archive ${document.name}`}>
                        Archive
                      </button>
                    </form>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Drive's archive File (REQ-153): the documents loose in `Archived`, each
// of which can come back to Unfiled.
export function DriveArchiveDocuments({ viewer, documents }: { viewer: PaperworkViewer; documents: DriveDocument[] }) {
  if (documents.length === 0) return <p className={styles.empty}>No loose documents in Archived.</p>;
  return (
    <ul className={`${styles.card} ${styles.rows}`} aria-label="Documents in the Archived folder">
      {documents.map((document) => (
        <li key={document.drive_id} className={styles.itemRow}>
          <span className={styles.itemText}>
            <DocumentName document={document} />
            <span className={styles.note}>{ownerText(document, viewer.people)}</span>
          </span>
          <span className={styles.rowActions}>
            <form action={bringBackDriveDocument} className={styles.inlineForm}>
              <input type="hidden" name="documentId" value={document.drive_id} />
              <button type="submit" className={buttonClass} aria-label={`Bring back ${document.name}`}>
                Bring back
              </button>
            </form>
          </span>
        </li>
      ))}
    </ul>
  );
}
