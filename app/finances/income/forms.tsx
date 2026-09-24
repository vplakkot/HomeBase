"use client";

import { useActionState } from "react";
import type { Person } from "../../../lib/finances/budget-year";
import { INCOME_KINDS, type ExpectedPaycheck } from "../../../lib/finances/leftover";
import styles from "../../../components/cards.module.css";
import { logIncome, type FormState } from "./actions";

const initialState: FormState = {};

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{saved}</p>;
  return null;
}

// REQ-60: a paycheck the income setup expects, filled in to confirm.
// The amount can be corrected if what landed differs.
export function ConfirmPaycheckForm({ monthId, paycheck }: { monthId: string; paycheck: ExpectedPaycheck }) {
  const [state, formAction, pending] = useActionState(logIncome, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="monthId" value={monthId} />
      <input type="hidden" name="ownerId" value={paycheck.owner_id} />
      <input type="hidden" name="kind" value="paycheck" />
      <input type="hidden" name="sourceId" value={paycheck.source_id} />
      <input type="hidden" name="receivedOn" value={paycheck.payday} />
      <input type="hidden" name="note" value={paycheck.name} />
      <label className={styles.field}>
        <span>Amount</span>
        <span className={styles.withPrefix}>
          <span aria-hidden="true">$</span>
          <input
            name="amount"
            aria-label={`Amount of ${paycheck.name} on ${paycheck.payday}`}
            inputMode="decimal"
            defaultValue={paycheck.amount.toFixed(2)}
            required
          />
        </span>
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Confirm"}
      </button>
      <Outcome state={state} saved="Confirmed." />
    </form>
  );
}

// REQ-60: any other money that landed: ESPP or RSU sales, a bonus, or
// something else.
export function IncomeForm({
  monthId,
  people,
  firstDay,
  lastDay,
}: {
  monthId: string;
  people: Person[];
  firstDay: string;
  lastDay: string;
}) {
  const [state, formAction, pending] = useActionState(logIncome, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="monthId" value={monthId} />
      <label className={styles.field}>
        <span>Kind</span>
        <select name="kind" aria-label="Kind of income" required defaultValue="bonus">
          {Object.entries(INCOME_KINDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Whose</span>
        <select name="ownerId" aria-label="Whose income it is" required>
          {people.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Amount</span>
        <span className={styles.withPrefix}>
          <span aria-hidden="true">$</span>
          <input name="amount" aria-label="Amount of the income" inputMode="decimal" placeholder="2400.00" required />
        </span>
      </label>
      <label className={styles.field}>
        <span>Day it landed</span>
        <input
          type="date"
          name="receivedOn"
          aria-label="Day the income landed"
          defaultValue={lastDay}
          min={firstDay}
          max={lastDay}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Note</span>
        <input name="note" aria-label="Note about the income" placeholder="Q3 bonus" />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Log income"}
      </button>
      <Outcome state={state} saved="Income logged." />
    </form>
  );
}
