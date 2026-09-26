import { listBills } from "../../../lib/finances/bills";
import { householdToday, listPeople, listSplits, monthLabel, monthStart } from "../../../lib/finances/budget-year";
import {
  billEntered,
  chosenMonth,
  dayLabel,
  dueInMonth,
  listOpenedMonths,
  monthShares,
  readMonth,
  type MonthBill,
} from "../../../lib/finances/month";
import { formatMoney } from "../../../lib/finances/money";
import styles from "../../../components/cards.module.css";
import { FinancesFrame, financesViewer } from "../frame";
import { Hint } from "../../../components/hint";
import { openMonth, removeDirectPayment, removePersonalCharge } from "./actions";
import { BillEntryForm, DirectPaymentForm, PersonalChargeForm } from "./forms";

const SECTION = "Monthly entry";

// What's still missing from a bill, in words, or null once it's entered.
function missing(bill: MonthBill): string | null {
  if (bill.amount === null) return "Not entered";
  if (billEntered(bill)) return null;
  return bill.personal_answer === "some" ? "Add the personal charges" : "Answer the personal-charges question";
}

// The Monthly entry section (docs/design/DESIGN.md §7): open the month,
// then enter every bill (REQ-53), declare personal charges inside card
// statements (REQ-54) and log shared spend one person paid (REQ-55,
// "one-time payments" on screen).
// Entry is shared: every member sees what the other entered.
export default async function MonthlyEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();
  const { month: asked } = await searchParams;
  const todayIso = householdToday();
  const [opened, people, bills, splits] = await Promise.all([
    listOpenedMonths(supabase),
    listPeople(supabase),
    listBills(supabase),
    listSplits(supabase),
  ]);
  const startsOn = chosenMonth(asked, opened, todayIso);
  const month = opened.includes(startsOn) ? await readMonth(supabase, startsOn) : null;
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const frame = {
    canManageMembers,
    account,
    section: SECTION,
    canManageBudget,
    month: { startsOn, closed: Boolean(month?.closed_at) },
  };

  if (!month) {
    const running = startsOn === monthStart(todayIso);
    return (
      <FinancesFrame {...frame}>
        <div className={styles.cards}>
          <section className={styles.card} aria-labelledby="open-month">
            <header className={styles.head}>
              <h2 id="open-month" className={styles.name}>
                {monthLabel(startsOn)}
              </h2>
            </header>
            <div className={styles.addBlock}>
              <p className={styles.empty}>
                {running
                  ? `Opening the month copies in the household's ${bills.length} bill${bills.length === 1 ? "" : "s"}, ready to enter. Changes to the bill list after that apply from the next month opened.`
                  : "This month was never opened."}
              </p>
              {running ? (
                <form action={openMonth} className={styles.form}>
                  <button type="submit" className={styles.primary}>
                    Open {monthLabel(startsOn)}
                  </button>
                </form>
              ) : null}
            </div>
          </section>
        </div>
      </FinancesFrame>
    );
  }

  const cards = month.bills.filter((bill) => bill.kind === "card").map((bill) => bill.name);
  // The date field runs from the 1st to today, or to the month's last day
  // for a month gone by.
  const [year, monthNumber] = month.starts_on.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const lastDay = todayIso < monthEnd ? todayIso : monthEnd;
  // A closed month is shown as it was closed, with nothing to change
  // (REQ-59); the database refuses changes to it anyway.
  const closed = month.closed_at !== null;

  return (
    <FinancesFrame {...frame}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="month-bills">
          <header className={styles.head}>
            <h2 id="month-bills" className={styles.name}>
              Bills
            </h2>
            <Hint text="This month's statements plus this month's rent." />
          </header>
          <div className={styles.entries}>
            {month.bills.length === 0 ? (
              <p className={styles.empty}>This month has no bills to enter.</p>
            ) : (
              <ul className={styles.list}>
                {month.bills.map((bill) => {
                  // Still to enter: "Not entered" in plain text, its form
                  // open. Entered: its amount, the form folded under Change
                  // (REQ-106).
                  const gap = missing(bill);
                  const charges =
                    bill.personal_answer === "some" ? (
                      <section aria-label={`Personal charges on ${bill.name}`} className={styles.charges}>
                        <h3 className={styles.chargesTitle}>Personal charges</h3>
                        {bill.personal_charges.length === 0 ? (
                          <p className={styles.empty}>None declared yet.</p>
                        ) : (
                          <ul className={styles.list}>
                            {bill.personal_charges.map((charge) => (
                              <li key={charge.id} className={styles.charge}>
                                <span>
                                  {nameOf.get(charge.owner_id) ?? "Someone"} · {formatMoney(charge.amount)}
                                  {charge.note ? ` · ${charge.note}` : ""}
                                </span>
                                {closed ? null : (
                                  <form action={removePersonalCharge}>
                                    <input type="hidden" name="id" value={charge.id} />
                                    <button type="submit" className={styles.quiet}>
                                      Remove
                                    </button>
                                  </form>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {closed ? null : <PersonalChargeForm bill={bill} people={people} />}
                      </section>
                    ) : null;
                  return (
                    <li key={bill.id} className={gap ? styles.todo : styles.entry}>
                      <div className={styles.entryHead}>
                        <span className={styles.entryName}>{bill.name}</span>
                        {gap ? (
                          <span className={styles.status}>{gap}</span>
                        ) : (
                          <span className={styles.amount}>{formatMoney(bill.amount ?? 0)}</span>
                        )}
                      </div>
                      <p className={styles.detail}>{dueInMonth(bill.due_day, month.starts_on)}</p>
                      {closed ? (
                        charges
                      ) : gap ? (
                        <>
                          <BillEntryForm bill={bill} />
                          {charges}
                        </>
                      ) : (
                        <details className={styles.change}>
                          <summary>Change</summary>
                          <BillEntryForm bill={bill} />
                          {charges}
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="direct-payments">
          <header className={styles.head}>
            <h2 id="direct-payments" className={styles.name}>
              One-time Payments
            </h2>
            <Hint
              text={`Shared spend one of you paid by cash, Venmo or a personal card; the other owes their share. Anything on ${cards.length > 0 ? cards.join(" or ") : "a tracked card"} is already in its statement.`}
            />
          </header>
          <div className={styles.entries}>
            <ul className={styles.list}>
              {closed ? null : (
                <li className={styles.todo}>
                  <span className={styles.entryName}>New One-time Payment</span>
                  <DirectPaymentForm
                    monthId={month.id}
                    people={people}
                    firstDay={month.starts_on}
                    lastDay={lastDay}
                  />
                </li>
              )}
              {month.direct_payments.map((payment) => (
                <li key={payment.id} className={styles.entry}>
                  <div className={styles.entryHead}>
                    <span className={styles.entryName}>{payment.note}</span>
                    <span className={styles.amount}>{formatMoney(payment.amount)}</span>
                  </div>
                  <p className={styles.detail}>
                    {nameOf.get(payment.payer_id) ?? "Someone"} · {dayLabel(payment.paid_on)}
                  </p>
                  {closed ? null : (
                    <form action={removeDirectPayment}>
                      <input type="hidden" name="id" value={payment.id} />
                      <button type="submit" className={styles.quiet}>
                        Remove
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </FinancesFrame>
  );
}
