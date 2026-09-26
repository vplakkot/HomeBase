"use client";

import { useActionState, useEffect, useState } from "react";
import styles from "../../components/cards.module.css";
import type { StorageEntry } from "../../lib/storage/storage";
import { addEntry, removeEntry, updateEntry, type FormState } from "./actions";

const initialState: FormState = {};

function Outcome({ state }: { state: FormState }) {
  return state.error ? (
    <p role="alert" className={styles.error}>
      {state.error}
    </p>
  ) : null;
}

// A form in a sheet tells the sheet once it has saved, so the sheet can
// close (REQ-107).
function useOnSaved(state: FormState, onSaved?: (state: FormState) => void) {
  useEffect(() => {
    if (state.saved) onSaved?.(state);
  }, [state, onSaved]);
}

// REQ-87: add an entry, or (with `entry`) change any of its fields. Only
// a box has contents, so the contents field shows only while it's ticked.
export function EntryForm({ entry, onSaved }: { entry?: StorageEntry; onSaved?: (state: FormState) => void }) {
  const [state, formAction, pending] = useActionState(entry ? updateEntry : addEntry, initialState);
  const [isBox, setIsBox] = useState(entry?.is_box ?? false);
  useOnSaved(state, onSaved);
  return (
    <form action={formAction} className={styles.form}>
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      <label className={styles.field}>
        <span>Name</span>
        <input name="name" required defaultValue={entry?.name ?? ""} placeholder="Seasonal clothes" />
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          name="isBox"
          value="yes"
          checked={isBox}
          onChange={(event) => setIsBox(event.target.checked)}
        />
        It&apos;s a box
      </label>
      {isBox ? (
        <label className={styles.field}>
          <span>Contents (optional, one item per line)</span>
          <textarea name="contents" rows={5} defaultValue={entry?.contents ?? ""} />
        </label>
      ) : null}
      <label className={styles.field}>
        <span>Note (optional)</span>
        <textarea name="note" rows={2} defaultValue={entry?.note ?? ""} />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : entry ? "Save changes" : "Add to storage"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

// REQ-87: removing asks first — choosing Remove from the Manage menu opens
// this question, and only Yes removes. A box holding archived files is
// refused with what to do.
export function RemoveEntryForm({ entry, label, onKeep }: { entry: StorageEntry; label: string; onKeep: () => void }) {
  const [state, formAction, pending] = useActionState(removeEntry, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={entry.id} />
      <p className={styles.check}>
        Remove {label} {entry.name}? Its ID won&apos;t be used again.
      </p>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Removing…" : "Yes, remove it"}
        </button>
        <button type="button" className={styles.quiet} onClick={onKeep}>
          Keep it
        </button>
      </div>
      <Outcome state={state} />
    </form>
  );
}
