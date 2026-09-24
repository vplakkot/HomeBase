"use client";

import { useActionState } from "react";
import type { RecordedSavings } from "../../../lib/finances/savings";
import styles from "../../../components/cards.module.css";
import local from "./page.module.css";
import { recordSavings, type FormState } from "./actions";

const initialState: FormState = {};

// REQ-66: what each person put into joint and saved on their own. Blank
// means nothing.
export function SavingsForm({
  monthId,
  people,
  recorded,
}: {
  monthId: string;
  people: { user_id: string; name: string }[];
  recorded: RecordedSavings[];
}) {
  const [state, formAction, pending] = useActionState(recordSavings, initialState);
  const shown = (amount: number | undefined) => (amount ? amount.toFixed(2) : "");
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="monthId" value={monthId} />
      {people.map((person) => {
        const row = recorded.find((saved) => saved.user_id === person.user_id);
        return (
          <fieldset key={person.user_id} className={local.person}>
            <legend className={styles.entryName}>{person.name}</legend>
            <input type="hidden" name="userId" value={person.user_id} />
            <label className={styles.field}>
              <span>Into joint</span>
              <span className={styles.withPrefix}>
                <span aria-hidden="true">$</span>
                <input
                  name={`joint-${person.user_id}`}
                  aria-label={`${person.name} put into joint`}
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={shown(row?.to_joint)}
                />
              </span>
            </label>
            <label className={styles.field}>
              <span>Saved on their own</span>
              <span className={styles.withPrefix}>
                <span aria-hidden="true">$</span>
                <input
                  name={`own-${person.user_id}`}
                  aria-label={`${person.name} saved on their own`}
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={shown(row?.own)}
                />
              </span>
            </label>
          </fieldset>
        );
      })}
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error ? (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      ) : state.saved ? (
        <p role="status" className={styles.saved}>
          Saved.
        </p>
      ) : null}
    </form>
  );
}
