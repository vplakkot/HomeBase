"use client";

import { useActionState, useState } from "react";
import styles from "../../components/cards.module.css";
import type { StorageEntry } from "../../lib/storage/storage";
import { addEntry, removeEntry, updateEntry, type FormState } from "./actions";

const initialState: FormState = {};

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{saved}</p>;
  return null;
}

// REQ-87: add an entry, or (with `entry`) change any of its fields. Only
// a box has contents, so the contents field shows only while it's ticked.
export function EntryForm({ entry }: { entry?: StorageEntry }) {
  const [state, formAction, pending] = useActionState(entry ? updateEntry : addEntry, initialState);
  const [isBox, setIsBox] = useState(entry?.is_box ?? false);
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
        {pending ? "Saving…" : entry ? "Save changes" : "Add the entry"}
      </button>
      <Outcome state={state} saved="Saved." />
    </form>
  );
}

// REQ-87: removing asks first. The first press only asks; the second
// removes. A box holding archived files is refused with what to do.
export function RemoveEntryForm({ entry, label }: { entry: StorageEntry; label: string }) {
  const [state, formAction, pending] = useActionState(removeEntry, initialState);
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <div className={`${styles.actions} ${styles.form}`}>
        <button type="button" className={styles.quiet} onClick={() => setAsking(true)}>
          Remove {label}
        </button>
      </div>
    );
  }
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
        <button type="button" className={styles.quiet} onClick={() => setAsking(false)}>
          Keep it
        </button>
      </div>
      <Outcome state={state} saved="Removed." />
    </form>
  );
}
