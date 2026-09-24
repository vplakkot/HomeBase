"use client";

import { useActionState, useEffect, useState } from "react";
import styles from "../../components/cards.module.css";
import type { Person } from "../../lib/finances/budget-year";
import { keepUntil, labelText, type Category, type Paper, type PaperFile } from "../../lib/paperwork/paperwork";
import { entryId, type StorageEntry } from "../../lib/storage/storage";
import {
  addCategory,
  archiveFile,
  bringBackFile,
  filePaper,
  logPaper,
  makeFile,
  removeCategory,
  updateCategory,
  updateFile,
  updatePaper,
  type FormState,
} from "./actions";

const initialState: FormState = {};

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{saved}</p>;
  return null;
}

// A new file's three fields (REQ-88): category and location required,
// the label name optional.
function NewFileFields({
  categories,
  file,
  onCategory,
}: {
  categories: Category[];
  file?: PaperFile;
  onCategory?: (id: string) => void;
}) {
  return (
    <>
      <label className={styles.field}>
        <span>Category</span>
        <select
          name="categoryId"
          required
          defaultValue={file?.category_id ?? ""}
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
      <label className={styles.field}>
        <span>Location</span>
        <input name="location" required placeholder="Where the file is kept" defaultValue={file?.location ?? ""} />
      </label>
      <label className={styles.field}>
        <span>Label name (optional)</span>
        <input name="label" defaultValue={file?.label ?? ""} />
      </label>
    </>
  );
}

// Which file: Unfiled (when allowed), an active file, or a new one made
// on the spot (REQ-97). Tells the form which category that means, so
// keep-until can fill itself in.
function FileChooser({
  files,
  categories,
  initial,
  allowUnfiled,
  onCategory,
}: {
  files: PaperFile[];
  categories: Category[];
  initial: string;
  allowUnfiled: boolean;
  onCategory: (id: string | null) => void;
}) {
  const [choice, setChoice] = useState(initial);
  const categoryOf = (fileId: string) => files.find((file) => file.id === fileId)?.category_id ?? null;
  const open = files.filter((file) => file.status === "active" || file.id === initial);
  return (
    <>
      <label className={styles.field}>
        <span>File</span>
        <select
          name="fileId"
          required={!allowUnfiled}
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value);
            onCategory(event.target.value === "new" ? null : categoryOf(event.target.value));
          }}
        >
          {allowUnfiled ? <option value="">Unfiled</option> : <option value="" disabled>Choose a file</option>}
          {open.map((file) => (
            <option key={file.id} value={file.id}>
              {labelText(file, categories.find((category) => category.id === file.category_id))}
              {file.label ? ` — ${file.label}` : ""}
            </option>
          ))}
          <option value="new">New file…</option>
        </select>
      </label>
      {choice === "new" ? <NewFileFields categories={categories} onCategory={(id) => onCategory(id)} /> : null}
    </>
  );
}

// REQ-97: keep-until pre-fills from the file's category (document date,
// or the day it was logged, plus the category's years) whenever the file
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

// REQ-97: log new paperwork, or (with `paper`) change any of its fields.
export function PaperForm({
  people,
  files,
  categories,
  today,
  paper,
  onLogged,
}: {
  people: Person[];
  files: PaperFile[];
  categories: Category[];
  today: string;
  paper?: Paper;
  onLogged?: () => void;
}) {
  const [state, formAction, pending] = useActionState(paper ? updatePaper : logPaper, initialState);
  useEffect(() => {
    if (state.saved) onLogged?.();
  }, [state, onLogged]);
  const initialFile = paper?.file_id ?? "";
  const keep = useKeepUntil(
    paper ?? { keep_until: null, document_date: null, logged_on: today },
    categories,
    files.find((file) => file.id === initialFile)?.category_id ?? null,
  );
  return (
    <form action={formAction} className={styles.form}>
      {paper ? <input type="hidden" name="id" value={paper.id} /> : null}
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
      <FileChooser
        files={files}
        categories={categories}
        initial={initialFile}
        allowUnfiled
        onCategory={keep.onCategory}
      />
      <KeepUntilField value={keep.value} onType={keep.onType} />
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : paper ? "Save changes" : "Log paperwork"}
      </button>
      <Outcome state={state} saved={paper ? "Saved." : "Logged."} />
    </form>
  );
}

// REQ-97: log paperwork one at a time. Each one logged starts a fresh,
// empty form, so nothing from the last one carries over.
export function LogPaperForm(props: { people: Person[]; files: PaperFile[]; categories: Category[]; today: string }) {
  const [logged, setLogged] = useState(0);
  return (
    <>
      <PaperForm key={logged} {...props} onLogged={() => setLogged((count) => count + 1)} />
      {logged > 0 ? (
        <p role="status" className={styles.saved}>
          Logged.
        </p>
      ) : null}
    </>
  );
}

// REQ-97: file an unfiled paper into an existing file or a new one.
export function FileItForm({
  paper,
  files,
  categories,
}: {
  paper: Paper;
  files: PaperFile[];
  categories: Category[];
}) {
  const [state, formAction, pending] = useActionState(filePaper, initialState);
  const keep = useKeepUntil(paper, categories, null);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={paper.id} />
      <FileChooser files={files} categories={categories} initial="" allowUnfiled={false} onCategory={keep.onCategory} />
      <KeepUntilField value={keep.value} onType={keep.onType} />
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Filing…" : `File ${paper.name}`}
      </button>
      <Outcome state={state} saved="Filed." />
    </form>
  );
}

// REQ-88: make a file on its own, before anything goes in it.
export function NewFileForm({ categories }: { categories: Category[] }) {
  const [state, formAction, pending] = useActionState(makeFile, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <NewFileFields categories={categories} />
      <button type="submit" className={styles.primary} disabled={pending || categories.length === 0}>
        {pending ? "Making…" : "Make the file"}
      </button>
      <Outcome state={state} saved="Made." />
    </form>
  );
}

// REQ-88: change a file's category, location or label. Its number stays.
export function FileEditForm({ file, categories }: { file: PaperFile; categories: Category[] }) {
  const [state, formAction, pending] = useActionState(updateFile, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={file.id} />
      <NewFileFields categories={categories} file={file} />
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Save the file"}
      </button>
      <Outcome state={state} saved="Saved." />
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
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : category ? "Save the category" : "Add the category"}
      </button>
      <Outcome state={state} saved="Saved." />
    </form>
  );
}

// REQ-88: remove a category. If files use it, they have to be moved to
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
          <span>{inUse === 1 ? "Move its 1 file to" : `Move its ${inUse} files to`}</span>
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
      <button type="submit" className={styles.quiet} disabled={pending || (inUse > 0 && others.length === 0)}>
        {inUse > 0 ? `Move the files and remove ${category.name}` : `Remove ${category.name}`}
      </button>
      <Outcome state={state} saved="Removed." />
    </form>
  );
}

// REQ-98: archive the whole file into a storage box. Only boxes are
// offered.
export function ArchiveFileForm({ file, boxes }: { file: PaperFile; boxes: StorageEntry[] }) {
  const [state, formAction, pending] = useActionState(archiveFile, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={file.id} />
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
      <button type="submit" className={styles.primary} disabled={pending || boxes.length === 0}>
        {pending ? "Archiving…" : "Archive the file"}
      </button>
      <Outcome state={state} saved="Archived." />
    </form>
  );
}

// REQ-98: bring an archived file back to the office, somewhere new.
export function BringBackForm({ file }: { file: PaperFile }) {
  const [state, formAction, pending] = useActionState(bringBackFile, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={file.id} />
      <label className={styles.field}>
        <span>New location</span>
        <input name="location" required placeholder="Where the file is kept now" />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Bring it back"}
      </button>
      <Outcome state={state} saved="Back in the office." />
    </form>
  );
}
