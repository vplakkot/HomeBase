"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { BottomSheet } from "../../components/bottom-sheet";
import { ButtonLink, buttonClass } from "../../components/button";
import { SettingsIcon } from "../../components/icons";
import type { Person } from "../../lib/finances/budget-year";
import type { Category, Paper, PaperFile } from "../../lib/paperwork/paperwork";
import type { StorageEntry } from "../../lib/storage/storage";
import type { FormState } from "./actions";
import {
  ArchiveFileForm,
  BringBackForm,
  FileEditForm,
  FileItForm,
  NewFileForm,
  PaperForm,
  RemoveFileForm,
} from "./forms";
import styles from "./paperwork.module.css";

// What the forms in Paperwork's sheets need to offer choices.
export type PaperworkChoices = {
  people: Person[];
  files: PaperFile[];
  categories: Category[];
  locations: string[];
  today: string;
};

// REQ-100: a form in a sheet leaves you on the screen underneath. Once it
// saves, the sheet closes; if it made a file, a one-time notice shows the
// file's label to print, and closing that leaves you where you were too.
function useSheet() {
  const [open, setOpen] = useState(false);
  const [newFile, setNewFile] = useState<string | null>(null);
  const saved = useCallback((state: FormState) => {
    setOpen(false);
    if (state.newFile) setNewFile(state.newFile);
  }, []);
  const notice = (
    <BottomSheet open={newFile !== null} onClose={() => setNewFile(null)} title="New file: print its label">
      <div className={styles.sheetBody}>
        <p className={styles.label} aria-label={`Label: ${newFile ?? ""}`}>
          {newFile}
        </p>
        <p className={styles.empty}>Type this into your label printer. The ID never changes.</p>
      </div>
    </BottomSheet>
  );
  return { open, setOpen, saved, notice };
}

// The header's tools on every Paperwork screen (DESIGN.md §11): the one
// search, the settings gear for an admin, and Log document. The search
// stays on the screen it's typed on: results replace the view, and Clear
// goes back to it.
export function HeaderTools({
  here,
  query,
  choices,
  settings,
}: {
  here: string;
  query: string;
  choices: PaperworkChoices;
  settings: boolean;
}) {
  const sheet = useSheet();
  return (
    <div className={styles.tools}>
      <form method="get" action={here} role="search" className={styles.search}>
        <SearchIcon />
        <label htmlFor="paperwork-search" className={styles.hidden}>
          Search files and documents
        </label>
        <input
          id="paperwork-search"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search files and documents"
        />
        {query ? (
          <Link href={here} className={styles.clear}>
            Clear
          </Link>
        ) : null}
      </form>
      {settings ? (
        <ButtonLink href="/paperwork/settings" label="Paperwork settings">
          <SettingsIcon size={20} />
        </ButtonLink>
      ) : null}
      <button type="button" className={buttonClass} onClick={() => sheet.setOpen(true)}>
        Log document
      </button>
      <BottomSheet open={sheet.open} onClose={() => sheet.setOpen(false)} title="Log document">
        {sheet.open ? <PaperForm {...choices} onSaved={sheet.saved} /> : null}
      </BottomSheet>
      {sheet.notice}
    </div>
  );
}

// REQ-100: "Add document" on a file logs straight into it.
export function AddPaperwork({ file, choices }: { file: PaperFile; choices: PaperworkChoices }) {
  const sheet = useSheet();
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => sheet.setOpen(true)}>
        Add document
      </button>
      <BottomSheet open={sheet.open} onClose={() => sheet.setOpen(false)} title="Add document">
        {sheet.open ? <PaperForm {...choices} intoFile={file} onSaved={sheet.saved} /> : null}
      </BottomSheet>
    </>
  );
}

type Manage = "edit" | "label" | "archive" | "remove";

// REQ-100: everything done to a file lives behind one menu; nothing is
// edited on the file's screen itself.
export function ManageFile({
  file,
  label,
  boxes,
  choices,
}: {
  file: PaperFile;
  label: string;
  boxes: StorageEntry[];
  choices: PaperworkChoices;
}) {
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<Manage | null>(null);
  const close = useCallback(() => setOpen(null), []);
  // A sheet closing because another one opened fires its own close; that
  // must only close it, not the one just opened.
  const closer = (which: Manage) => () => setOpen((now) => (now === which ? null : now));
  const choose = (which: Manage) => {
    setMenu(false);
    setOpen(which);
  };
  const archived = file.status === "archived";
  return (
    <>
      <button
        type="button"
        className={buttonClass}
        aria-expanded={menu}
        aria-controls="manage-file"
        onClick={() => setMenu((now) => !now)}
      >
        Manage file
        <ChevronIcon />
      </button>
      {menu ? (
        <ul id="manage-file" className={styles.menu} aria-label="Manage file">
          <li>
            <button type="button" className={styles.menuItem} onClick={() => choose("edit")}>
              Edit category, label or location
            </button>
          </li>
          <li>
            <button type="button" className={styles.menuItem} onClick={() => choose("label")}>
              Show label to reprint
            </button>
          </li>
          <li>
            <button type="button" className={styles.menuItem} onClick={() => choose("archive")}>
              {archived ? "Bring back from storage" : "Archive to a storage box"}
            </button>
          </li>
          <li className={styles.divider} aria-hidden="true" />
          <li>
            <button type="button" className={styles.menuItem} onClick={() => choose("remove")}>
              Remove file
            </button>
          </li>
        </ul>
      ) : null}
      <BottomSheet open={open === "edit"} onClose={closer("edit")} title="Edit the file">
        {open === "edit" ? (
          <FileEditForm file={file} categories={choices.categories} locations={choices.locations} onSaved={close} />
        ) : null}
      </BottomSheet>
      <BottomSheet open={open === "label"} onClose={closer("label")} title="Its label">
        <div className={styles.sheetBody}>
          <p className={styles.label} aria-label={`Label: ${label}`}>
            {label}
          </p>
          <p className={styles.empty}>Type this into your label printer.</p>
        </div>
      </BottomSheet>
      <BottomSheet
        open={open === "archive"}
        onClose={closer("archive")}
        title={archived ? "Bring it back" : "Archive to a storage box"}
      >
        {open !== "archive" ? null : archived ? (
          <BringBackForm file={file} locations={choices.locations} onSaved={close} />
        ) : boxes.length === 0 ? (
          <div className={styles.sheetBody}>
            <p className={styles.empty}>There are no storage boxes yet.</p>
            <Link href="/storage/add" className={buttonClass}>
              Add a box in Storage
            </Link>
          </div>
        ) : (
          <div className={styles.sheetBody}>
            <p className={styles.empty}>The whole file goes. To keep some of it, move those documents first.</p>
            <ArchiveFileForm file={file} boxes={boxes} onSaved={close} />
          </div>
        )}
      </BottomSheet>
      <BottomSheet open={open === "remove"} onClose={closer("remove")} title="Remove the file">
        <RemoveFileForm file={file} label={label} />
      </BottomSheet>
    </>
  );
}

// REQ-97, REQ-100: "File it" on the unfiled list, or "Move to another
// file" on a paper's details, in a sheet.
export function FileItButton({
  paper,
  choices,
  moving = false,
}: {
  paper: Paper;
  choices: PaperworkChoices;
  moving?: boolean;
}) {
  const sheet = useSheet();
  const title = moving ? "Move to another file" : `File ${paper.name}`;
  return (
    <>
      <button
        type="button"
        className={buttonClass}
        aria-label={moving ? undefined : `File ${paper.name}`}
        onClick={() => sheet.setOpen(true)}
      >
        {moving ? "Move to another file" : "File it"}
      </button>
      <BottomSheet open={sheet.open} onClose={() => sheet.setOpen(false)} title={title}>
        {sheet.open ? (
          <FileItForm
            paper={paper}
            files={choices.files}
            categories={choices.categories}
            locations={choices.locations}
            moving={moving}
            onSaved={sheet.saved}
          />
        ) : null}
      </BottomSheet>
      {sheet.notice}
    </>
  );
}

// REQ-88: a file made before anything goes in it, from the place it'll
// be kept in.
export function NewFile({ location, choices }: { location?: string; choices: PaperworkChoices }) {
  const sheet = useSheet();
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => sheet.setOpen(true)}>
        New file
      </button>
      <BottomSheet open={sheet.open} onClose={() => sheet.setOpen(false)} title="New file">
        {sheet.open ? (
          <NewFileForm
            categories={choices.categories}
            locations={choices.locations}
            location={location}
            onSaved={sheet.saved}
          />
        ) : null}
      </BottomSheet>
      {sheet.notice}
    </>
  );
}

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);
const ChevronIcon = () => (
  <Svg size={16}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
