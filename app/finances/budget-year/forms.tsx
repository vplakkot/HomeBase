"use client";

import { useActionState, useState } from "react";
import { BILL_KINDS, ordinal, type Bill } from "../../../lib/finances/bills";
import { formatPercent, monthLabel, parsePercent, type Person } from "../../../lib/finances/budget-year";
import { CADENCES, type IncomeSource } from "../../../lib/finances/income";
import { saveBill, saveIncomeSource, saveSplit, type FormState } from "./actions";
import styles from "./page.module.css";

const initialState: FormState = {};
const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{state.message ?? saved}</p>;
  return null;
}

// REQ-50, #132: a split starts in a month and holds until a later one
// starts, so changing it never reaches back into months already run.
export function SplitForm({
  people,
  months,
  month,
  percents,
  note,
  editing,
}: {
  people: Person[];
  months: { value: string; label: string }[];
  month: string;
  percents?: Record<string, number>;
  note?: string;
  editing?: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveSplit, initialState);
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(people.map((p) => [p.user_id, percents?.[p.user_id]?.toString() ?? ""])),
  );
  const parsed = Object.values(typed).map(parsePercent);
  const total = parsed.every((value) => value !== null)
    ? parsed.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const what = editing ? `the split from ${monthLabel(`${month}-01`)}` : "the new split";

  return (
    <form action={formAction} className={styles.form}>
      {editing ? (
        // A split being edited keeps its month: moving it would leave the
        // old one behind and write a second split instead.
        <>
          <input type="hidden" name="effectiveFrom" value={month} />
          <input type="hidden" name="editing" value="true" />
          <p className={styles.total}>In force from {monthLabel(`${month}-01`)}</p>
        </>
      ) : (
        <label className={styles.field}>
          <span>In force from</span>
          <select name="effectiveFrom" defaultValue={month} aria-label={`Month ${what} starts`}>
            {months.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {people.map((person) => (
        <label key={person.user_id} className={styles.field}>
          <span>{person.name}</span>
          <span className={styles.withSuffix}>
            <input
              name={`share:${person.user_id}`}
              aria-label={`${person.name}'s share of ${what}`}
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
        <textarea
          name="note"
          rows={2}
          defaultValue={note}
          aria-label={`What ${what} is based on`}
          placeholder="The incomes and savings you assumed"
        />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : editing ? "Save split" : "Add split"}
      </button>
      <Outcome state={state} saved="Split saved." />
    </form>
  );
}

// REQ-51: a name, whose pay, take-home per payment, how often and one real
// payday. Changing one ends it today and starts a new one (#132), so the
// paydays it already covered keep their amount.
export function IncomeForm({ people, source }: { people: Person[]; source?: IncomeSource }) {
  const [state, formAction, pending] = useActionState(saveIncomeSource, initialState);
  const what = source ? source.name || "this source" : "new income source";
  return (
    <form action={formAction} className={styles.form}>
      {source ? <input type="hidden" name="id" value={source.id} /> : null}
      <label className={styles.field}>
        <span>Name</span>
        <input
          name="name"
          defaultValue={source?.name}
          aria-label={`Name of ${what}`}
          placeholder="Day job, Saturday shifts…"
          required
        />
      </label>
      <label className={styles.field}>
        <span>Whose pay</span>
        <select
          name="ownerId"
          defaultValue={source?.owner_id}
          aria-label={`Whose pay ${what} is`}
          required
        >
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
            defaultValue={source?.net_amount}
            aria-label={`Take-home per payment of ${what}`}
            inputMode="decimal"
            placeholder="2,400.00"
            required
          />
        </span>
      </label>
      <label className={styles.field}>
        <span>How often</span>
        <select
          name="cadence"
          defaultValue={source?.cadence ?? "biweekly"}
          aria-label={`How often ${what} is paid`}
        >
          {Object.entries(CADENCES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>One real payday</span>
        <input
          name="anchorDate"
          type="date"
          defaultValue={source?.anchor_date}
          aria-label={`A real payday of ${what}`}
          required
        />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : source ? "Save changes" : "Add income source"}
      </button>
      <Outcome state={state} saved="Income source added." />
    </form>
  );
}

// REQ-94: name, type and the day of the month it's due — a day, not a
// date, because the same bill comes round every month.
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
        <span className={styles.hint} id={`due-hint-${bill?.id ?? "new"}`}>
          Shorter months use their last day.
        </span>
        <select
          name="dueDay"
          defaultValue={bill?.due_day ?? 1}
          aria-label={`Due day of ${what}`}
          aria-describedby={`due-hint-${bill?.id ?? "new"}`}
        >
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
