"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Person, Share } from "../../../lib/finances/budget-year";
import type { MonthBill } from "../../../lib/finances/month";
import styles from "../../../components/cards.module.css";
import { Hint } from "../../../components/hint";
import { addDirectPayment, addPersonalCharge, enterBill, setMonthSplit, settleMonth, type FormState } from "./actions";

const initialState: FormState = {};

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  if (state.error) return <p role="alert" className={styles.error}>{state.error}</p>;
  if (state.saved) return <p role="status" className={styles.saved}>{saved}</p>;
  return null;
}

// REQ-53: one bill's amount for the month. A card statement also asks
// whether personal charges are still inside it (REQ-54) — a required
// choice, so it can't be saved without an answer. Rent never asks.
export function BillEntryForm({ bill }: { bill: MonthBill }) {
  const [state, formAction, pending] = useActionState(enterBill, initialState);
  const isCard = bill.kind === "card";
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={bill.id} />
      <input type="hidden" name="kind" value={bill.kind} />
      <label className={styles.field}>
        <span>{isCard ? "Statement balance" : "Amount"}</span>
        <span className={styles.withPrefix}>
          <span aria-hidden="true">$</span>
          <input
            name="amount"
            aria-label={`Amount of ${bill.name}`}
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={bill.amount ?? undefined}
            required
          />
        </span>
      </label>
      {isCard ? (
        <fieldset className={styles.field} aria-labelledby={`personal-${bill.id}`}>
          <legend>
            <span id={`personal-${bill.id}`}>Any personal charges still inside this balance?</span>{" "}
            <Hint text="Only charges still in the balance. Anything paid off before the statement closed stays out." />
          </legend>
          <label>
            <input
              type="radio"
              name="personal"
              value="none"
              defaultChecked={bill.personal_answer === "none"}
              required
            />{" "}
            No, it&apos;s all shared
          </label>
          <label>
            <input
              type="radio"
              name="personal"
              value="some"
              defaultChecked={bill.personal_answer === "some"}
            />{" "}
            Yes, some are personal
          </label>
        </fieldset>
      ) : null}
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : bill.amount === null ? `Enter ${bill.name}` : `Save ${bill.name}`}
      </button>
      <Outcome state={state} saved={`${bill.name} saved.`} />
    </form>
  );
}

// REQ-54: an amount, whose it is, and an optional note. It leaves the
// shared base and is that person's in full.
export function PersonalChargeForm({ bill, people }: { bill: MonthBill; people: Person[] }) {
  const [state, formAction, pending] = useActionState(addPersonalCharge, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="monthBillId" value={bill.id} />
      <label className={styles.field}>
        <span>Amount</span>
        <span className={styles.withPrefix}>
          <span aria-hidden="true">$</span>
          <input
            name="amount"
            aria-label={`Amount of a personal charge on ${bill.name}`}
            inputMode="decimal"
            placeholder="45.00"
            required
          />
        </span>
      </label>
      <label className={styles.field}>
        <span>Whose</span>
        <select name="ownerId" aria-label={`Whose personal charge on ${bill.name}`} required>
          {people.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Note (optional)</span>
        <input name="note" aria-label={`Note for a personal charge on ${bill.name}`} placeholder="Birthday gift" />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Add personal charge"}
      </button>
      <Outcome state={state} saved="Personal charge added." />
    </form>
  );
}

// REQ-55: shared spend one person paid outside the tracked cards — a
// "one-time payment" on screen (Vin, 2026-09-23). It's always already
// paid, so it asks for the day it was, within the month.
export function DirectPaymentForm({
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
  const [state, formAction, pending] = useActionState(addDirectPayment, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="monthId" value={monthId} />
      <label className={styles.field}>
        <span>Who paid</span>
        <select name="payerId" aria-label="Who paid the One-time Payment" required>
          {people.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Total</span>
        <span className={styles.withPrefix}>
          <span aria-hidden="true">$</span>
          <input
            name="amount"
            aria-label="Total of the One-time Payment"
            inputMode="decimal"
            placeholder="64.20"
            required
          />
        </span>
      </label>
      <label className={styles.field}>
        <span>Date paid</span>
        <input
          type="date"
          name="paidOn"
          aria-label="Date the One-time Payment was paid"
          defaultValue={lastDay}
          min={firstDay}
          max={lastDay}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Note</span>
        <input
          name="note"
          aria-label="What the One-time Payment was for"
          placeholder="Groceries, paid on Venmo"
          required
        />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Log One-time Payment"}
      </button>
      <Outcome state={state} saved="One-time Payment logged." />
    </form>
  );
}

// REQ-148: a month added later divides by its own split, a copy of the
// one in force then (or today's, if none had started), changed here for
// that month only.
export function MonthSplitForm({ monthId, people, shares }: { monthId: string; people: Person[]; shares: Share[] }) {
  const [state, formAction, pending] = useActionState(setMonthSplit, initialState);
  const percentOf = new Map(shares.map((share) => [share.user_id, share.percent]));
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="monthId" value={monthId} />
      {people.map((person) => (
        <label key={person.user_id} className={styles.field}>
          <span>{person.name}</span>
          <span className={styles.withPrefix}>
            <input
              name={`share_${person.user_id}`}
              aria-label={`${person.name}'s percentage`}
              inputMode="decimal"
              defaultValue={percentOf.get(person.user_id)?.toString() ?? ""}
              required
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>
      ))}
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Save this month's split"}
      </button>
      <Outcome state={state} saved="Split saved for this month." />
    </form>
  );
}

// REQ-148: we sorted the month out between us outside the app. It
// closes with nobody owing anything for it.
export function SettleForm({ monthId, month }: { monthId: string; month: string }) {
  const [state, formAction, pending] = useActionState(settleMonth, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="monthId" value={monthId} />
      <input type="hidden" name="month" value={month} />
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Settling…" : "Mark settled"}
      </button>
      <Link href={`/finances/log-payment?month=${month}`} className={styles.quiet}>
        Log payments instead
      </Link>
      <Outcome state={state} saved="Settled." />
    </form>
  );
}

