"use client";

import { useActionState } from "react";
import type { Person } from "../../../lib/finances/budget-year";
import type { MonthBill } from "../../../lib/finances/month";
import styles from "../budget-year/page.module.css";
import { addDirectPayment, addPersonalCharge, enterBill, type FormState } from "./actions";

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
        <fieldset className={styles.field}>
          <legend>Any personal charges still inside this balance?</legend>
          <span className={styles.hint}>
            Only charges still in the balance. Anything paid off before the statement closed
            stays out.
          </span>
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

// REQ-55: shared spend one person paid outside the tracked cards.
export function DirectPaymentForm({ monthId, people }: { monthId: string; people: Person[] }) {
  const [state, formAction, pending] = useActionState(addDirectPayment, initialState);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="monthId" value={monthId} />
      <label className={styles.field}>
        <span>Who paid</span>
        <select name="payerId" aria-label="Who paid the direct payment" required>
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
            aria-label="Total of the direct payment"
            inputMode="decimal"
            placeholder="64.20"
            required
          />
        </span>
      </label>
      <label className={styles.field}>
        <span>Note</span>
        <input
          name="note"
          aria-label="What the direct payment was for"
          placeholder="Groceries, paid on Venmo"
          required
        />
      </label>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : "Log direct payment"}
      </button>
      <Outcome state={state} saved="Direct payment logged." />
    </form>
  );
}
