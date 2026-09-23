"use client";

import { useActionState } from "react";
import type { Person } from "../../../lib/finances/budget-year";
import { formatMoney } from "../../../lib/finances/money";
import styles from "../budget-year/page.module.css";
import { savePayment, type FormState } from "./actions";
import own from "./page.module.css";

const initialState: FormState = {};

export type BillChoice = { id: string; name: string; left: number };

// REQ-57, as the design's sheet has it (docs/design/DESIGN.md §7): who
// paid, the amount, and the bill it went toward. `payment` fills it in
// to change one already logged; its bill is offered even once paid off.
export function PaymentForm({
  people,
  bills,
  payment,
}: {
  people: Person[];
  bills: BillChoice[];
  payment?: { id: string; payer_id: string; month_bill_id: string; amount: number };
}) {
  const [state, formAction, pending] = useActionState(savePayment, initialState);
  const which = payment ? "this payment" : "the payment";
  const offered = bills.filter((bill) => bill.left > 0 || bill.id === payment?.month_bill_id);
  return (
    <form action={formAction} className={styles.form}>
      {payment ? <input type="hidden" name="id" value={payment.id} /> : null}
      <fieldset className={own.choices}>
        <legend>Who paid</legend>
        {people.map((person) => (
          <label key={person.user_id} className={own.choice}>
            <input
              type="radio"
              name="payerId"
              value={person.user_id}
              defaultChecked={payment?.payer_id === person.user_id}
              required
            />
            {person.name}
          </label>
        ))}
      </fieldset>
      <label className={styles.field}>
        <span>Amount</span>
        <span className={styles.withPrefix}>
          <span aria-hidden="true">$</span>
          <input
            name="amount"
            aria-label={`Amount of ${which}`}
            inputMode="decimal"
            placeholder="180.00"
            defaultValue={payment ? payment.amount.toFixed(2) : undefined}
            required
          />
        </span>
      </label>
      <fieldset className={own.choices}>
        <legend>Toward</legend>
        {offered.length === 0 ? (
          <p className={styles.empty}>Every bill entered so far is paid in full.</p>
        ) : (
          offered.map((bill) => (
            <label key={bill.id} className={own.choice}>
              <input
                type="radio"
                name="monthBillId"
                value={bill.id}
                defaultChecked={payment?.month_bill_id === bill.id}
                required
              />
              {bill.name}
              <span className={own.left}>{bill.left > 0 ? `${formatMoney(bill.left)} left` : "Paid"}</span>
            </label>
          ))
        )}
      </fieldset>
      <button type="submit" className={styles.primary} disabled={pending || offered.length === 0}>
        {pending ? "Saving…" : payment ? "Save changes" : "Save payment"}
      </button>
      {state.error ? (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      ) : state.saved ? (
        <p role="status" className={styles.saved}>
          {payment ? "Payment changed." : "Payment logged."}
        </p>
      ) : null}
    </form>
  );
}
