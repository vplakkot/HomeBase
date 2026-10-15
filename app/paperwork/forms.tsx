"use client";

import { useActionState, useEffect, useState } from "react";
import { buttonClass } from "../../components/button";
import styles from "../../components/cards.module.css";
import type { Person } from "../../lib/finances/budget-year";
import { keepUntil, labelText, type Category, type Location, type Paper, type PaperFileFolder } from "../../lib/paperwork/paperwork";
import { entryId, type StorageEntry } from "../../lib/storage/storage";
import {
  addCategory,
  addLocation,
  archiveFileFolder,
  archivePaper,
  bringBackFileFolder,
  deleteLocation,
  filePaper,
  logPaper,
  makeFileFolder,
  removeCategory,
  removeFileFolder,
  renameLocation,
  updateCategory,
  updateFileFolder,
  updatePaper,
  type FormState,
} from "./actions";

const initialState: FormState = {};

// Tells whoever opened the form (a sheet, REQ-100) that it saved, once
// per save, so the sheet can close and show any new File Folder's label.
function useOnSaved(state: FormState, onSaved?: (state: FormState) => void) {
  useEffect(() => {
    if (state.saved) onSaved?.(state);
  }, [state, onSaved]);
}

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{saved}</p>;
  return null;
}

// Where a File Folder is kept (REQ-179): pick from the locations, or "New
// location…" to name one on the spot. There's no free typing into the
// list, so one place keeps one spelling.
function LocationField({
  label,
  locations,
  defaultValue,
  driveReady = false,
  optional = false,
}: {
  label: string;
  locations: Location[];
  defaultValue?: string;
  // REQ-206: a physical File Folder may have no location yet, which reads
  // "Not placed". Bringing one back from storage still asks for a place.
  optional?: boolean;
  // Google Drive (built in, REQ-152) is offered only to a new File Folder, and
  // only once a folder is connected; a physical File Folder never goes there.
  driveReady?: boolean;
}) {
  const [choice, setChoice] = useState(defaultValue ?? "");
  return (
    <>
      <label className={styles.field}>
        <span>{label}</span>
        <select name="locationId" required={!optional} value={choice} onChange={(event) => setChoice(event.target.value)}>
          {optional ? (
            <option value="">Not placed</option>
          ) : (
            <option value="" disabled>
              Choose a location
            </option>
          )}
          {locations
            .filter((location) => !location.built_in || driveReady)
            .map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          <option value="new">New location…</option>
        </select>
      </label>
      {choice === "new" ? (
        <label className={styles.field}>
          <span>New location name</span>
          <input name="newLocation" required placeholder="Office · Cabinet" />
        </label>
      ) : null}
    </>
  );
}

// A new File Folder's three fields (REQ-88): category required, the location
// (REQ-206) and the label name optional.
function NewFileFolderFields({
  categories,
  locations,
  fileFolder,
  location,
  driveReady = false,
  onCategory,
}: {
  categories: Category[];
  locations: Location[];
  fileFolder?: PaperFileFolder;
  location?: string;
  driveReady?: boolean;
  onCategory?: (id: string) => void;
}) {
  return (
    <>
      <label className={styles.field}>
        <span>Category</span>
        <select
          name="categoryId"
          required
          defaultValue={fileFolder?.category_id ?? ""}
          onChange={(event) => onCategory?.(event.target.value)}
        >
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      {fileFolder?.is_drive ? (
        // A Drive File Folder's location is set when it's made and never changes.
        <p className={styles.check}>Location: Google Drive</p>
      ) : (
        <LocationField
          label="Location"
          locations={locations}
          defaultValue={fileFolder?.location_id ?? location}
          driveReady={driveReady}
          optional
        />
      )}
      <label className={styles.field}>
        <span>Label name (optional)</span>
        <input name="label" defaultValue={fileFolder?.label ?? ""} />
      </label>
    </>
  );
}

// Which File Folder: Unfiled (when allowed), an active File Folder, or a new one made
// on the spot (REQ-97). Tells the form which category that means, so
// keep-until can fill itself in.
function FileFolderChooser({
  fileFolders,
  categories,
  locations,
  allowUnfiled,
  label = "File Folder",
  onCategory,
}: {
  fileFolders: PaperFileFolder[];
  categories: Category[];
  locations: Location[];
  allowUnfiled: boolean;
  label?: string;
  onCategory: (id: string | null) => void;
}) {
  const [choice, setChoice] = useState("");
  const categoryOf = (fileFolderId: string) => fileFolders.find((fileFolder) => fileFolder.id === fileFolderId)?.category_id ?? null;
  // Physical paperwork goes only into physical File Folders (REQ-152).
  const open = fileFolders.filter((fileFolder) => fileFolder.status === "active" && !fileFolder.is_drive);
  return (
    <>
      <label className={styles.field}>
        <span>{label}</span>
        <select
          name="fileFolderId"
          required={!allowUnfiled}
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value);
            onCategory(event.target.value === "new" ? null : categoryOf(event.target.value));
          }}
        >
          {allowUnfiled ? <option value="">Unfiled</option> : <option value="" disabled>Choose a File Folder</option>}
          {open.map((fileFolder) => (
            <option key={fileFolder.id} value={fileFolder.id}>
              {labelText(fileFolder, categories.find((category) => category.id === fileFolder.category_id))}
              {fileFolder.label ? ` — ${fileFolder.label}` : ""}
            </option>
          ))}
          <option value="new">New File Folder…</option>
        </select>
      </label>
      {choice === "new" ? (
        <NewFileFolderFields categories={categories} locations={locations} onCategory={(id) => onCategory(id)} />
      ) : null}
    </>
  );
}

// REQ-97: keep-until pre-fills from the File Folder's category (document date,
// or the day it was logged, plus the category's years) whenever the File Folder
// or the document date changes, until someone types in it or clears it.
function useKeepUntil(paper: Pick<Paper, "keep_until" | "document_date" | "logged_on">, categories: Category[], initialCategory: string | null) {
  const [value, setValue] = useState(paper.keep_until ?? "");
  const [typed, setTyped] = useState(paper.keep_until !== null);
  const [documentDate, setDocumentDate] = useState(paper.document_date);
  const [category, setCategory] = useState(initialCategory);
  const prefill = (nextCategory: string | null, nextDate: string | null) => {
    const years = categories.find((row) => row.id === nextCategory)?.keep_years ?? null;
    const worked = keepUntil(nextDate, paper.logged_on, years);
    if (!typed && worked) setValue(worked);
  };
  return {
    value,
    onType: (next: string) => {
      setValue(next);
      setTyped(true);
    },
    onCategory: (next: string | null) => {
      setCategory(next);
      prefill(next, documentDate);
    },
    onDocumentDate: (next: string) => {
      setDocumentDate(next || null);
      prefill(category, next || null);
    },
  };
}

function KeepUntilField({ value, onType }: { value: string; onType: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span>Keep until (optional)</span>
      <input type="date" name="keepUntil" value={value} onChange={(event) => onType(event.target.value)} />
    </label>
  );
}

// REQ-97: log new paperwork, or (with `paper`) change any of its fields
// but its File Folder, which "Move to another File Folder" changes (REQ-100). With
// `intoFile`, it's logged straight into that File Folder ("Add paperwork" on a
// File Folder's screen).
export function PaperForm({
  people,
  fileFolders,
  categories,
  locations,
  today,
  paper,
  intoFileFolder,
  onSaved,
}: {
  people: Person[];
  fileFolders: PaperFileFolder[];
  categories: Category[];
  locations: Location[];
  today: string;
  paper?: Paper;
  intoFileFolder?: PaperFileFolder;
  onSaved?: (state: FormState) => void;
}) {
  const [state, formAction, pending] = useActionState(paper ? updatePaper : logPaper, initialState);
  useOnSaved(state, onSaved);
  const keep = useKeepUntil(
    paper ?? { keep_until: null, document_date: null, logged_on: today },
    categories,
    fileFolders.find((fileFolder) => fileFolder.id === (paper?.file_folder_id ?? intoFileFolder?.id))?.category_id ?? null,
  );
  return (
    <form action={formAction} className={styles.form}>
      {paper ? <input type="hidden" name="id" value={paper.id} /> : null}
      {intoFileFolder ? <input type="hidden" name="fileFolderId" value={intoFileFolder.id} /> : null}
      <label className={styles.field}>
        <span>Name</span>
        <input name="name" required defaultValue={paper?.name ?? ""} />
      </label>
      <label className={styles.field}>
        <span>Owner</span>
        <select name="ownerId" defaultValue={paper ? (paper.owner_id ?? "joint") : "joint"}>
          <option value="joint">Joint</option>
          {people.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Document date (optional)</span>
        <input
          type="date"
          name="documentDate"
          defaultValue={paper?.document_date ?? ""}
          onChange={(event) => keep.onDocumentDate(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>Notes (optional)</span>
        <textarea name="notes" rows={2} defaultValue={paper?.notes ?? ""} />
      </label>
      {paper || intoFileFolder ? null : (
        <FileFolderChooser
          fileFolders={fileFolders}
          categories={categories}
          locations={locations}
          allowUnfiled
          onCategory={keep.onCategory}
        />
      )}
      <KeepUntilField value={keep.value} onType={keep.onType} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : paper ? "Save changes" : "Log document"}
      </button>
      <Outcome state={state} saved={paper ? "Saved." : "Logged."} />
    </form>
  );
}

// REQ-97: File Folder an unfiled paper into an existing File Folder or a new one; or
// (REQ-100, `moving`) move a filed one to another File Folder.
export function FileItForm({
  paper,
  fileFolders,
  categories,
  locations,
  moving = false,
  onSaved,
}: {
  paper: Paper;
  fileFolders: PaperFileFolder[];
  categories: Category[];
  locations: Location[];
  moving?: boolean;
  onSaved?: (state: FormState) => void;
}) {
  const [state, formAction, pending] = useActionState(filePaper, initialState);
  useOnSaved(state, onSaved);
  const keep = useKeepUntil(paper, categories, null);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={paper.id} />
      {moving ? <input type="hidden" name="moving" value="yes" /> : null}
      <FileFolderChooser
        fileFolders={fileFolders.filter((fileFolder) => fileFolder.id !== paper.file_folder_id)}
        categories={categories}
        locations={locations}
        allowUnfiled={moving}
        label={moving ? "Move to" : "File Folder"}
        onCategory={keep.onCategory}
      />
      <KeepUntilField value={keep.value} onType={keep.onType} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : moving ? "Move it" : `File ${paper.name}`}
      </button>
      <Outcome state={state} saved={moving ? "Moved." : "Filed."} />
    </form>
  );
}

// REQ-88: make a File Folder on its own, before anything goes in it.
export function NewFileFolderForm({
  categories,
  locations,
  location,
  driveReady = false,
  onSaved,
}: {
  categories: Category[];
  locations: Location[];
  location?: string;
  driveReady?: boolean;
  onSaved?: (state: FormState) => void;
}) {
  const [state, formAction, pending] = useActionState(makeFileFolder, initialState);
  useOnSaved(state, onSaved);
  return (
    <form action={formAction} className={styles.form}>
      <NewFileFolderFields categories={categories} locations={locations} location={location} driveReady={driveReady} />
      <button type="submit" className={buttonClass} disabled={pending || categories.length === 0}>
        {pending ? "Making…" : "Make the File Folder"}
      </button>
      <Outcome state={state} saved="Made." />
    </form>
  );
}

// REQ-88: change a File Folder's category, location or label. Its number stays.
export function FileFolderEditForm({
  fileFolder,
  categories,
  locations,
  onSaved,
}: {
  fileFolder: PaperFileFolder;
  categories: Category[];
  locations: Location[];
  onSaved?: (state: FormState) => void;
}) {
  const [state, formAction, pending] = useActionState(updateFileFolder, initialState);
  useOnSaved(state, onSaved);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={fileFolder.id} />
      <NewFileFolderFields categories={categories} locations={locations} fileFolder={fileFolder} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : "Save the File Folder"}
      </button>
      <Outcome state={state} saved="Saved." />
    </form>
  );
}

// REQ-88: remove a File Folder. Its paperwork goes back to Unfiled, and its
// number is never handed out again. The sheet it sits in is the "are you
// sure?".
export function RemoveFileFolderForm({ fileFolder, label, returnTo }: { fileFolder: PaperFileFolder; label: string; returnTo: string }) {
  const drive = fileFolder.is_drive;
  return (
    <form action={removeFileFolder} className={styles.form}>
      <input type="hidden" name="id" value={fileFolder.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <p className={styles.check}>
        {drive
          ? `Remove ${label}? Its Digital Folder and documents stay in Google Drive; only HomeBase forgets the File Folder.`
          : `Remove ${label}? Its documents go back to Unfiled.`}
      </p>
      <button type="submit" className={buttonClass}>
        Yes, remove the File Folder
      </button>
    </form>
  );
}

// REQ-88: add a category, or (with `category`) rename it or change how
// long its paperwork is kept.
export function CategoryForm({ category }: { category?: Category }) {
  const [state, formAction, pending] = useActionState(category ? updateCategory : addCategory, initialState);
  return (
    <form action={formAction} className={styles.form}>
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <label className={styles.field}>
        <span>Name</span>
        <input name="name" required defaultValue={category?.name ?? ""} />
      </label>
      <label className={styles.field}>
        <span>Keep for (years, optional)</span>
        <input
          name="keepYears"
          inputMode="numeric"
          placeholder="No default"
          defaultValue={category?.keep_years ?? ""}
        />
      </label>
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : category ? "Save the category" : "Add the category"}
      </button>
      <Outcome state={state} saved="Saved." />
    </form>
  );
}

// REQ-88: remove a category. If File Folders use it, they have to be moved to
// another category first, so the form asks where.
export function RemoveCategoryForm({
  category,
  others,
  inUse,
}: {
  category: Category;
  others: Category[];
  inUse: number;
}) {
  const [state, formAction, pending] = useActionState(removeCategory, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={category.id} />
      {inUse > 0 ? (
        <label className={styles.field}>
          <span>{inUse === 1 ? "Move its 1 File Folder to" : `Move its ${inUse} File Folders to`}</span>
          <select name="moveTo" required defaultValue="">
            <option value="" disabled>
              Choose a category
            </option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button type="submit" className={buttonClass} disabled={pending || (inUse > 0 && others.length === 0)}>
        {inUse > 0 ? `Move the File Folders and remove ${category.name}` : `Remove ${category.name}`}
      </button>
      <Outcome state={state} saved="Removed." />
    </form>
  );
}

// REQ-98: archive the whole File Folder into a storage box. Only boxes are
// offered.
export function ArchiveFileFolderForm({
  fileFolder,
  boxes,
  onSaved,
}: {
  fileFolder: PaperFileFolder;
  boxes: StorageEntry[];
  onSaved?: (state: FormState) => void;
}) {
  const [state, formAction, pending] = useActionState(archiveFileFolder, initialState);
  useOnSaved(state, onSaved);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={fileFolder.id} />
      <label className={styles.field}>
        <span>Box</span>
        <select name="boxId" required defaultValue="">
          <option value="" disabled>
            Choose a box
          </option>
          {boxes.map((box) => (
            <option key={box.id} value={box.id}>
              {entryId(box)} · {box.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={buttonClass} disabled={pending || boxes.length === 0}>
        {pending ? "Archiving…" : "Archive the File Folder"}
      </button>
      <Outcome state={state} saved="Archived." />
    </form>
  );
}

// REQ-98: bring an archived File Folder back to the office, somewhere new.
export function BringBackForm({
  fileFolder,
  locations,
  onSaved,
}: {
  fileFolder: PaperFileFolder;
  locations: Location[];
  onSaved?: (state: FormState) => void;
}) {
  const [state, formAction, pending] = useActionState(bringBackFileFolder, initialState);
  useOnSaved(state, onSaved);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={fileFolder.id} />
      <LocationField label="New location" locations={locations} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : "Restore it"}
      </button>
      <Outcome state={state} saved="Back in the office." />
    </form>
  );
}

// REQ-153: archive a single document into a storage box's archive. Only
// boxes are offered.
export function ArchivePaperForm({
  paper,
  boxes,
  onSaved,
}: {
  paper: Paper;
  boxes: StorageEntry[];
  onSaved?: (state: FormState) => void;
}) {
  const [state, formAction, pending] = useActionState(archivePaper, initialState);
  useOnSaved(state, onSaved);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={paper.id} />
      <label className={styles.field}>
        <span>Box</span>
        <select name="boxId" required defaultValue="">
          <option value="" disabled>
            Choose a box
          </option>
          {boxes.map((box) => (
            <option key={box.id} value={box.id}>
              {entryId(box)} · {box.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={buttonClass} disabled={pending || boxes.length === 0}>
        {pending ? "Archiving…" : `Archive ${paper.name}`}
      </button>
      <Outcome state={state} saved="Archived." />
    </form>
  );
}

// REQ-179: add a location, or (with `location`) rename it. A name that
// matches another is refused.
export function LocationForm({ location, onSaved }: { location?: Location; onSaved?: (state: FormState) => void }) {
  const [state, formAction, pending] = useActionState(location ? renameLocation : addLocation, initialState);
  useOnSaved(state, onSaved);
  return (
    <form action={formAction} className={styles.form}>
      {location ? <input type="hidden" name="id" value={location.id} /> : null}
      <label className={styles.field}>
        <span>Name</span>
        <input name="name" required defaultValue={location?.name ?? ""} placeholder="Office · Cabinet" />
      </label>
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Saving…" : location ? "Save the name" : "Add the location"}
      </button>
      <Outcome state={state} saved="Saved." />
    </form>
  );
}

// REQ-179: remove an empty location. The sheet it sits in is the "are you
// sure?".
export function DeleteLocationForm({ location }: { location: Location }) {
  const [state, formAction, pending] = useActionState(deleteLocation, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={location.id} />
      <p className={styles.check}>Remove {location.name}?</p>
      <button type="submit" className={buttonClass} disabled={pending}>
        Yes, remove the location
      </button>
      <Outcome state={state} saved="Removed." />
    </form>
  );
}
