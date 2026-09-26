"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BottomSheet } from "../../components/bottom-sheet";
import { buttonClass } from "../../components/button";
import { ChevronDownIcon, SearchIcon } from "../../components/icons";
import type { StorageEntry } from "../../lib/storage/storage";
import type { FormState } from "./actions";
import { EntryForm, RemoveEntryForm } from "./forms";
import styles from "./storage.module.css";

// The header's tools on every Storage screen (REQ-107): the one search
// and Add to storage. The search stays on the screen it's typed on:
// results replace the view, and Clear goes back to it. Adding happens in
// a sheet over the screen; once saved, a one-time notice shows the new ID
// to print, and closing it leaves you where you were.
export function HeaderTools({ here, query }: { here: string; query: string }) {
  const [open, setOpen] = useState(false);
  const [newEntry, setNewEntry] = useState<string | null>(null);
  const saved = useCallback((state: FormState) => {
    setOpen(false);
    if (state.newEntry) setNewEntry(state.newEntry);
  }, []);
  return (
    <div className={styles.tools}>
      <form method="get" action={here} role="search" className={styles.search}>
        <SearchIcon />
        <label htmlFor="storage-search" className={styles.hidden}>
          Search storage
        </label>
        <input
          id="storage-search"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search names, IDs, contents, notes"
        />
        {query ? (
          <Link href={here} className={styles.clear}>
            Clear
          </Link>
        ) : null}
      </form>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
        Add to storage
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Add to storage">
        {open ? <EntryForm onSaved={saved} /> : null}
      </BottomSheet>
      <BottomSheet open={newEntry !== null} onClose={() => setNewEntry(null)} title="New entry: print its label">
        <div className={styles.sheetBody}>
          <p className={styles.label} aria-label={`ID: ${newEntry ?? ""}`}>
            {newEntry}
          </p>
          <p className={styles.empty}>Type this into your label printer. The ID never changes; only boxes need one.</p>
        </div>
      </BottomSheet>
    </div>
  );
}

type Manage = "edit" | "label" | "remove";

// REQ-107: everything done to an entry lives behind one menu; nothing is
// edited on the entry's screen itself. The rules stay the database's and
// the actions': a box holding archived files can't be removed or stop
// being a box, and the sheet says why.
export function ManageEntry({ entry, label }: { entry: StorageEntry; label: string }) {
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
  return (
    <>
      <button
        type="button"
        className={buttonClass}
        aria-expanded={menu}
        aria-controls="manage-entry"
        onClick={() => setMenu((now) => !now)}
      >
        Manage
        <ChevronDownIcon />
      </button>
      {menu ? (
        <ul id="manage-entry" className={styles.menu} aria-label="Manage">
          <li>
            <button type="button" className={styles.menuItem} onClick={() => choose("edit")}>
              Edit
            </button>
          </li>
          <li>
            <button type="button" className={styles.menuItem} onClick={() => choose("label")}>
              Show label to reprint
            </button>
          </li>
          <li className={styles.divider} aria-hidden="true" />
          <li>
            <button type="button" className={styles.menuItem} onClick={() => choose("remove")}>
              Remove
            </button>
          </li>
        </ul>
      ) : null}
      <BottomSheet open={open === "edit"} onClose={closer("edit")} title={`Edit ${label}`}>
        {open === "edit" ? <EntryForm entry={entry} onSaved={close} /> : null}
      </BottomSheet>
      <BottomSheet open={open === "label"} onClose={closer("label")} title="Its label">
        <div className={styles.sheetBody}>
          <p className={styles.label} aria-label={`ID: ${label}`}>
            {label}
          </p>
          <p className={styles.empty}>Type this into your label printer.</p>
        </div>
      </BottomSheet>
      <BottomSheet open={open === "remove"} onClose={closer("remove")} title={`Remove ${label}`}>
        {open === "remove" ? <RemoveEntryForm entry={entry} label={label} onKeep={close} /> : null}
      </BottomSheet>
    </>
  );
}
