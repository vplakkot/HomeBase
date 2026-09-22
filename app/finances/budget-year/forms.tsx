"use client";

import { useActionState, useState } from "react";
import { BILL_KINDS, type Bill } from "../../../lib/finances/bills";
import { formatPercent, parsePercent, type Person } from "../../../lib/finances/budget-year";
import { CADENCES } from "../../../lib/finances/income";
import { addIncomeSource, saveBill, saveBudgetYear, type FormState } from "./actions";
import styles from "./page.module.css";

const initialState: FormState = {};

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{state.message ?? saved}</p>;
  return null;
}

// REQ-50: the April start year, a percentage for each person, and a note of
// what the split was based on. The running total is a courtesy; the server
// and the database both refuse anything that isn't 100.
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
      <label className={styles.field}>
        <span>Budget year starting April</span>
        <input name="startYear" type="number" inputMode="numeric" defaultValue={startYear} required />
      </label>
      {people.map((person) => (
        <label key={person.user_id} className={styles.field}>
          <span>{person.name}&apos;s share (%)</span>
          <input
            name={`share:${person.user_id}`}
            inputMode="decimal"
            value={typed[person.user_id]}
            onChange={(event) => setTyped({ ...typed, [person.user_id]: event.target.value })}
            required
          />
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

// REQ-51: owner, take-home amount per payment, how often, one real payday.
export function IncomeForm({ people }: { people: Person[] }) {
  const [state, formAction, pending] = useActionState(addIncomeSource, initialState);
  return (
    <form action={formAction} className={styles.form}>
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
        <span>Take-home per payment ($)</span>
        <input name="netAmount" inputMode="decimal" required />
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

// REQ-94: a bill's name, type and due day. With a bill, it changes that
// one; without, it adds a new one.
export function BillForm({ bill }: { bill?: Bill }) {
  const [state, formAction, pending] = useActionState(saveBill, initialState);
  const what = bill ? bill.name : "new bill";
  return (
    <form action={formAction} className={bill ? styles.inlineForm : styles.form}>
      {bill ? <input type="hidden" name="id" value={bill.id} /> : null}
      <label className={styles.field}>
        <span>Name</span>
        <input name="name" defaultValue={bill?.name} aria-label={`Name of ${what}`} required />
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
        <span>Due day</span>
        <input
          name="dueDay"
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          defaultValue={bill?.due_day}
          aria-label={`Due day of ${what}`}
          required
        />
      </label>
      <button type="submit" className={bill ? styles.secondary : styles.primary} disabled={pending}>
        {pending ? "Saving…" : bill ? "Save" : "Add bill"}
      </button>
      <Outcome state={state} saved={bill ? "Saved. It applies from the next month opened." : "Bill added."} />
    </form>
  );
}
