"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { buttonClass } from "../../components/button";
import styles from "../../components/cards.module.css";
import type { Person } from "../../lib/finances/budget-year";
import { labelText, type Category, type PaperFile } from "../../lib/paperwork/paperwork";
import {
  archiveDriveFile,
  bringBackDriveFile,
  connectDrive,
  fileDriveDocument,
  linkDriveFolder,
  linkUnlinkedFolder,
  refreshDrive,
  setDocumentOwner,
  type DriveState,
} from "./drive-actions";
import paperwork from "./paperwork.module.css";

// Google Drive's forms (REQ-152, REQ-153), apart from forms.tsx's.

const initialState: DriveState = {};

// A sync older than this is redone when Paperwork opens.
const STALE_MS = 60_000;

function Outcome({ state, saved }: { state: DriveState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{saved}</p>;
  return null;
}

// "Synced 3 min ago" and a Refresh button. Opening a Paperwork screen that
// shows Drive re-reads the folder when the last read is stale (REQ-152
// "Sync"); the time is worked out in the browser, which knows the clock.
export function DriveStatus({ syncedAt }: { syncedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const started = useRef(false);

  const sync = async () => {
    setBusy(true);
    const result = await refreshDrive();
    setProblem(result.error ?? null);
    setBusy(false);
    setNow(Date.now());
    router.refresh();
  };

  useEffect(() => {
    setNow(Date.now());
    if (started.current) return;
    started.current = true;
    if (!syncedAt || Date.now() - new Date(syncedAt).getTime() > STALE_MS) void sync();
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minutes = syncedAt && now !== null ? Math.max(0, Math.floor((now - new Date(syncedAt).getTime()) / 60_000)) : null;
  const when = !syncedAt ? "Not synced yet" : minutes === null ? "" : minutes < 1 ? "Synced just now" : `Synced ${minutes} min ago`;
  return (
    <p className={paperwork.driveStatus}>
      <span>Google Drive · {busy ? "Syncing…" : when}</span>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void sync()}>
        Refresh
      </button>
      {problem ? <span role="alert" className={styles.error}>{problem}</span> : null}
    </p>
  );
}

// REQ-152 "Connection": the admin sees the service account's email (to
// share the folder with) and pastes one folder link.
export function ConnectDriveForm({ email, connected }: { email: string | null; connected: boolean }) {
  const [state, formAction, pending] = useActionState(connectDrive, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <p className={styles.detail}>
        {email ? (
          <>
            Share the Drive folder with <strong>{email}</strong> as an Editor, make a sub-folder in it called{" "}
            <strong>Archived</strong>, then paste the folder&apos;s link.
          </>
        ) : (
          "The Google Drive key isn't set up on the server yet."
        )}
      </p>
      <label className={styles.field}>
        <span>{connected ? "Connect a different folder (link)" : "Folder link"}</span>
        <input name="link" required placeholder="https://drive.google.com/drive/folders/…" />
      </label>
      <button type="submit" className={buttonClass} disabled={pending || !email}>
        {pending ? "Checking…" : connected ? "Check and reconnect" : "Check and connect"}
      </button>
      <Outcome state={state} saved="Connected." />
    </form>
  );
}

// The exact folder name to make in Drive, with a button that copies it.
export function FolderName({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className={paperwork.folderName}>
      <code aria-label={`Folder name: ${name}`}>{name}</code>
      <button
        type="button"
        className={buttonClass}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(name);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </p>
  );
}

// REQ-152: "I've created it" finds the folder in Drive and links to it.
export function CreatedItForm({ file }: { file: Pick<PaperFile, "id"> }) {
  const [state, formAction, pending] = useActionState(linkDriveFolder, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={file.id} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Looking…" : "I've created it"}
      </button>
      <Outcome state={state} saved="Linked." />
    </form>
  );
}

function OwnerField({ people, defaultValue }: { people: Person[]; defaultValue: string }) {
  return (
    <label className={styles.field}>
      <span>Owner</span>
      <select name="ownerId" required defaultValue={defaultValue}>
        <option value="joint">Joint</option>
        {people.map((person) => (
          <option key={person.user_id} value={person.user_id}>
            {person.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// REQ-152 "Documents": file a Drive document into a Drive File. The owner
// has to be confirmed; it starts as the member who owns it in Drive.
export function FileDriveDocumentForm({
  documentId,
  name,
  files,
  categories,
  people,
  guess,
  onSaved,
}: {
  documentId: string;
  name: string;
  files: PaperFile[];
  categories: Category[];
  people: Person[];
  guess: string | null;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(fileDriveDocument, initialState);
  useEffect(() => {
    if (state.saved) onSaved?.();
  }, [state, onSaved]);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="documentId" value={documentId} />
      <label className={styles.field}>
        <span>Google Drive file</span>
        <select name="fileId" required defaultValue="">
          <option value="" disabled>
            Choose a file
          </option>
          {files.map((file) => (
            <option key={file.id} value={file.id}>
              {labelText(file, categories.find((category) => category.id === file.category_id))}
              {file.label ? ` — ${file.label}` : ""}
            </option>
          ))}
        </select>
      </label>
      <OwnerField people={people} defaultValue={guess ?? "joint"} />
      <button type="submit" className={buttonClass} disabled={pending || files.length === 0}>
        {pending ? "Moving…" : `File ${name}`}
      </button>
      {files.length === 0 ? <p className={styles.check}>No Google Drive file has its folder yet.</p> : null}
      <Outcome state={state} saved="Filed." />
    </form>
  );
}

// REQ-152: a document that reached a folder without being filed here has
// no owner decided; this sets it.
export function SetOwnerForm({ documentId, people, current }: { documentId: string; people: Person[]; current: string }) {
  const [state, formAction, pending] = useActionState(setDocumentOwner, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="documentId" value={documentId} />
      <OwnerField people={people} defaultValue={current} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : "Set the owner"}
      </button>
      <Outcome state={state} saved="Saved." />
    </form>
  );
}

// REQ-152 "Unlinked folder": link it to a File waiting for its folder.
export function LinkFolderForm({ folderId, files, categories }: { folderId: string; files: PaperFile[]; categories: Category[] }) {
  const [state, formAction, pending] = useActionState(linkUnlinkedFolder, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="folderId" value={folderId} />
      <label className={styles.field}>
        <span>Link it to</span>
        <select name="fileId" required defaultValue="">
          <option value="" disabled>
            A file waiting for its folder
          </option>
          {files.map((file) => (
            <option key={file.id} value={file.id}>
              {labelText(file, categories.find((category) => category.id === file.category_id))}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={buttonClass} disabled={pending || files.length === 0}>
        {pending ? "Linking…" : "Link the folder"}
      </button>
      <Outcome state={state} saved="Linked." />
    </form>
  );
}

// REQ-152: archive a Drive File (its folder moves into `Archived`), or
// bring it back (to the top level).
export function ArchiveDriveFileForm({ file, archived, onSaved }: { file: PaperFile; archived: boolean; onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState(archived ? bringBackDriveFile : archiveDriveFile, initialState);
  useEffect(() => {
    if (state.saved) onSaved?.();
  }, [state, onSaved]);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={file.id} />
      <p className={styles.check}>
        {archived
          ? "Its folder moves back to the top of the connected Google Drive folder."
          : "Its folder moves into the Archived folder in Google Drive."}
      </p>
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Moving…" : archived ? "Bring it back" : "Archive the file"}
      </button>
      <Outcome state={state} saved={archived ? "Back in Drive." : "Archived."} />
    </form>
  );
}
