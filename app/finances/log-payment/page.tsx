import Link from "next/link";
import { householdToday, listPeople, listSplits } from "../../../lib/finances/budget-year";
import {
  chosenMonth,
  listOpenedMonths,
  monthShares,
  monthStatus,
  monthTotals,
  pickableMonths,
  readMonth,
} from "../../../lib/finances/month";
import { formatMoney } from "../../../lib/finances/money";
import styles from "../budget-year/page.module.css";
import { FinancesFrame, financesViewer } from "../frame";
import { deletePayment } from "./actions";
import { PaymentForm } from "./forms";

const SECTION = "Log payment";

// The Log payment section (REQ-57): log money one of you sent to one of
// the month's bills, then see, change or delete the month's payments.
// The design draws it as a sheet over Finances home; it's a page here so
// the month's payments have somewhere to be changed. Every month is open
// until it closes; then its payments are locked (REQ-59).
export default async function LogPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; bill?: string }>;
}) {
  const { supabase, canManageMembers, account } = await financesViewer();
  const { month: asked, bill: chosen } = await searchParams;
  const todayIso = householdToday();
  const [opened, people, splits] = await Promise.all([
    listOpenedMonths(supabase),
    listPeople(supabase),
    listSplits(supabase),
  ]);
  const startsOn = chosenMonth(asked, opened, todayIso);
  const month = opened.includes(startsOn) ? await readMonth(supabase, startsOn) : null;
  const shares = monthShares(month, splits, startsOn);
  const frame = {
    canManageMembers,
    account,
    section: SECTION,
    status: monthStatus(month, shares, todayIso),
    month: { current: startsOn, options: pickableMonths(opened, todayIso) },
  };

  if (!month) {
    return (
      <FinancesFrame {...frame}>
        <div className={styles.cards}>
          <section className={styles.card} aria-labelledby="no-month">
            <header className={styles.head}>
              <h2 id="no-month" className={styles.name}>
                Nothing to pay toward yet
              </h2>
            </header>
            <div className={styles.addBlock}>
              <p className={styles.empty}>
                Payments go toward this month&apos;s bills, so open the month and enter them first.
              </p>
              <Link href={`/finances/monthly-entry?month=${startsOn.slice(0, 7)}`} className={styles.primary}>
                Go to Monthly entry
              </Link>
            </div>
          </section>
        </div>
      </FinancesFrame>
    );
  }

  const totals = monthTotals(month, shares);
  const closed = month.closed_at !== null;
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const choices = month.bills
    .filter((bill) => bill.amount !== null)
    .map((bill) => ({
      id: bill.id,
      name: bill.name,
      left: totals.bills.find((row) => row.id === bill.id)?.left ?? 0,
    }));
  const logged = month.bills.flatMap((bill) =>
    bill.payments.map((payment) => ({ ...payment, month_bill_id: bill.id, bill: bill.name })),
  );

  return (
    <FinancesFrame {...frame}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="log-payment">
          <header className={styles.head}>
            <h2 id="log-payment" className={styles.name}>
              Log a payment
            </h2>
            {totals.people.length > 0 ? (
              <p className={styles.note}>
                {totals.people
                  .map((person) => {
                    const name = nameOf.get(person.user_id) ?? "Someone";
                    return person.outstanding > 0
                      ? `${name} still owes ${formatMoney(person.outstanding)}`
                      : `${name} is paid up`;
                  })
                  .join(" · ")}
              </p>
            ) : null}
          </header>
          <div className={styles.addBlock}>
            {closed ? (
              <p className={styles.empty}>This month is closed, so its payments can&apos;t change.</p>
            ) : choices.length === 0 ? (
              <p className={styles.empty}>No bill has an amount entered yet, so there&apos;s nothing to pay toward.</p>
            ) : (
              <PaymentForm people={people} bills={choices} chosen={chosen} />
            )}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="payments">
          <header className={styles.head}>
            <h2 id="payments" className={styles.name}>
              Payments this month
            </h2>
          </header>
          <div className={styles.entries}>
            {logged.length === 0 ? (
              <p className={styles.empty}>None logged yet.</p>
            ) : (
              <ul className={styles.list}>
                {logged.map((payment) => {
                  const who = nameOf.get(payment.payer_id) ?? "Someone";
                  return (
                    <li key={payment.id} className={styles.entry}>
                      <div className={styles.entryHead}>
                        <span className={styles.entryName}>
                          {who} → {payment.bill}
                        </span>
                        <span className={styles.amount}>{formatMoney(payment.amount)}</span>
                      </div>
                      {closed ? null : (
                        <>
                      <details className={styles.change}>
                        <summary>Edit</summary>
                        <PaymentForm people={people} bills={choices} payment={payment} />
                      </details>
                      <form action={deletePayment}>
                        <input type="hidden" name="id" value={payment.id} />
                        <button
                          type="submit"
                          className={styles.quiet}
                          aria-label={`Delete ${who}'s ${formatMoney(payment.amount)} payment toward ${payment.bill}`}
                        >
                          Delete
                        </button>
                      </form>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </FinancesFrame>
  );
}
