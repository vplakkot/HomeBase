"use client";

import { useActionState, useState } from "react";
import { BILL_KINDS, ordinal, type Bill } from "../../../lib/finances/bills";
import { formatPercent, parsePercent, type Person } from "../../../lib/finances/budget-year";
import { CADENCES } from "../../../lib/finances/income";
import { addIncomeSource, saveBill, saveBudgetYear, type FormState } from "./actions";
import styles from "./page.module.css";

const initialState: FormState = {};
const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{state.message ?? saved}</p>;
  return null;
}

// REQ-50: a percentage for each person and a note of what the split was
// based on. The budget year isn't asked for — it's today's, worked out
// from the calendar and said in words above the form.
export function SplitForm({
  people,
  startYear,
  percents,
  note,
}: {
  people: Person[];
  startYear: number;
  percents: Record<string, number>;
  note: string;
}) {
  const [state, formAction, pending] = useActionState(saveBudgetYear, initialState);
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(people.map((p) => [p.user_id, percents[p.user_id]?.toString() ?? ""])),
  );
  const parsed = Object.values(typed).map(parsePercent);
  const total = parsed.every((value) => value !== null)
    ? parsed.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="startYear" value={startYear} />
      {people.map((person) => (
        <label key={person.user_id} className={styles.field}>
          <span>{person.name}&apos;s share</span>
          <span className={styles.withSuffix}>
            <input
              name={`share:${person.user_id}`}
              aria-label={`${person.name}'s share`}
              inputMode="decimal"
              value={typed[person.user_id]}
              onChange={(event) => setTyped({ ...typed, [person.user_id]: event.target.value })}
              required
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>
      ))}
      <p className={styles.total} aria-live="polite">
        Total: {total === null ? "—" : formatPercent(total)}
        {total !== null && total !== 100_00 ? " · must be 100%" : ""}
      </p>
      <label className={styles.field}>
        <span>Based on (optional)</span>
        <textarea name="note" rows={3} defaultValue={note} placeholder="The incomes and savings you assumed" />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Save split"}
      </button>
      <Outcome state={state} saved="Split saved." />
    </form>
  );
}

// REQ-51: a name, whose pay it is, take-home per payment, how often, and
// one real payday. The name is what tells two jobs apart.
export function IncomeForm({ people }: { people: Person[] }) {
  const [state, formAction, pending] = useActionState(addIncomeSource, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <label className={styles.field}>
        <span>Name</span>
        <input name="name" placeholder="Day job, Saturday shifts…" required />
      </label>
      <label className={styles.field}>
        <span>Whose pay</span>
        <select name="ownerId" required>
          {people.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Take-home per payment</span>
        <span className={styles.withPrefix}>
          <span aria-hidden="true">$</span>
          <input
            name="netAmount"
            aria-label="Take-home per payment"
            inputMode="decimal"
            placeholder="2,400.00"
            required
          />
        </span>
      </label>
      <label className={styles.field}>
        <span>How often</span>
        <select name="cadence" defaultValue="biweekly">
          {Object.entries(CADENCES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>One real payday</span>
        <input name="anchorDate" type="date" required />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Adding…" : "Add income source"}
      </button>
      <Outcome state={state} saved="Income source added." />
    </form>
  );
}

// REQ-94: a bill's name, type and the day of the month it's due — a day,
// not a date, because the same bill comes round every month. With a bill,
// the form changes that one; without, it adds a new one.
export function BillForm({ bill }: { bill?: Bill }) {
  const [state, formAction, pending] = useActionState(saveBill, initialState);
  const what = bill ? bill.name : "new bill";
  return (
    <form action={formAction} className={styles.form}>
      {bill ? <input type="hidden" name="id" value={bill.id} /> : null}
      <label className={styles.field}>
        <span>Name</span>
        <input
          name="name"
          defaultValue={bill?.name}
          placeholder="Rent, joint card…"
          aria-label={`Name of ${what}`}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Type</span>
        <select name="kind" defaultValue={bill?.kind ?? "card"} aria-label={`Type of ${what}`}>
          {Object.entries(BILL_KINDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Due every month on the</span>
        <select name="dueDay" defaultValue={bill?.due_day ?? 1} aria-label={`Due day of ${what}`}>
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {ordinal(day)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : bill ? "Save changes" : "Add bill"}
      </button>
      <Outcome state={state} saved={bill ? "Saved. It applies from the next month opened." : "Bill added."} />
    </form>
  );
}
