"use client";

import { useActionState } from "react";
import { ACCOUNT_ORDER, ACCOUNTS, type Account } from "../../../lib/finances/balances";
import styles from "../../../components/cards.module.css";
import local from "./page.module.css";
import { saveBalances, type FormState } from "./actions";

const initialState: FormState = {};

// REQ-67: one person's five balances for a month. Boxes start with this
// month's figure, or last month's as a starting point; blank isn't saved.
export function BalancesForm({
  month,
  person,
  starting,
}: {
  month: string;
  person: { user_id: string; name: string };
  starting: Partial<Record<Account, number>>;
}) {
  const [state, formAction, pending] = useActionState(saveBalances, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="userId" value={person.user_id} />
      <fieldset className={local.person}>
        <legend className={styles.entryName}>{person.name}</legend>
        {ACCOUNT_ORDER.map((account) => (
          <label key={account} className={styles.field}>
            <span>{ACCOUNTS[account]}</span>
            <span className={styles.withPrefix}>
              <span aria-hidden="true">$</span>
              <input
                name={account}
                aria-label={`${person.name}'s ${ACCOUNTS[account]}`}
                inputMode="decimal"
                placeholder="Not entered"
                defaultValue={starting[account] === undefined ? "" : starting[account].toFixed(2)}
              />
            </span>
          </label>
        ))}
      </fieldset>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : `Save ${person.name}'s balances`}
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
