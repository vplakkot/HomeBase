import { listBills } from "../../../lib/finances/bills";
import { householdToday, listPeople, monthLabel, monthStart } from "../../../lib/finances/budget-year";
import {
  billEntered,
  chosenMonth,
  dayLabel,
  dueInMonth,
  listOpenedMonths,
  monthStatus,
  pickableMonths,
  readMonth,
  type MonthBill,
} from "../../../lib/finances/month";
import { formatMoney } from "../../../lib/finances/money";
import styles from "../budget-year/page.module.css";
import { FinancesFrame, financesViewer } from "../frame";
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
  const { supabase, canManageMembers, account } = await financesViewer();
  const { month: asked } = await searchParams;
  const todayIso = householdToday();
  const [opened, people, bills] = await Promise.all([
    listOpenedMonths(supabase),
    listPeople(supabase),
    listBills(supabase),
  ]);
  const startsOn = chosenMonth(asked, opened, todayIso);
  const month = opened.includes(startsOn) ? await readMonth(supabase, startsOn) : null;
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const frame = {
    canManageMembers,
    account,
    section: SECTION,
    status: monthStatus(month),
    month: { current: startsOn, options: pickableMonths(opened, todayIso) },
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

  return (
    <FinancesFrame {...frame}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="month-bills">
          <header className={styles.head}>
            <h2 id="month-bills" className={styles.name}>
              Bills
            </h2>
            <p className={styles.note}>
              This month&apos;s statements plus this month&apos;s rent.
            </p>
          </header>
          <div className={styles.entries}>
            {month.bills.length === 0 ? (
              <p className={styles.empty}>This month has no bills to enter.</p>
            ) : (
              <ul className={styles.list}>
                {month.bills.map((bill) => {
                  const gap = missing(bill);
                  return (
                    <li key={bill.id} className={styles.entry}>
                      <div className={styles.entryHead}>
                        <span className={styles.entryName}>{bill.name}</span>
                        {gap ? (
                          <span className={styles.chip}>{gap}</span>
                        ) : (
                          <span className={styles.amount}>{formatMoney(bill.amount ?? 0)}</span>
                        )}
                      </div>
                      <p className={styles.detail}>{dueInMonth(bill.due_day, month.starts_on)}</p>
                      <BillEntryForm bill={bill} />
                      {bill.personal_answer === "some" ? (
                        <section aria-label={`Personal charges on ${bill.name}`}>
                          <h3 className={styles.addTitle}>Personal charges</h3>
                          {bill.personal_charges.length === 0 ? (
                            <p className={styles.empty}>None declared yet.</p>
                          ) : (
                            <ul className={styles.list}>
                              {bill.personal_charges.map((charge) => (
                                <li key={charge.id} className={styles.entry}>
                                  <div className={styles.entryHead}>
                                    <span className={styles.entryName}>
                                      {nameOf.get(charge.owner_id) ?? "Someone"}
                                    </span>
                                    <span className={styles.amount}>{formatMoney(charge.amount)}</span>
                                  </div>
                                  {charge.note ? <p className={styles.detail}>{charge.note}</p> : null}
                                  <form action={removePersonalCharge}>
                                    <input type="hidden" name="id" value={charge.id} />
                                    <button type="submit" className={styles.quiet}>
                                      Remove
                                    </button>
                                  </form>
                                </li>
                              ))}
                            </ul>
                          )}
                          <PersonalChargeForm bill={bill} people={people} />
                        </section>
                      ) : null}
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
              One-time payments
            </h2>
          </header>
          <div className={styles.addBlock}>
            <p className={styles.empty}>
              Shared spend one of you paid by cash, Venmo or a personal card. The other owes
              their share of it.
              {cards.length > 0
                ? ` Anything on ${cards.join(" or ")} is already in its statement, so don't log it here.`
                : " Anything on a tracked card is already in its statement, so don't log it here."}
            </p>
            <DirectPaymentForm
              monthId={month.id}
              people={people}
              firstDay={month.starts_on}
              lastDay={lastDay}
            />
          </div>
          <div className={styles.entries}>
            {month.direct_payments.length === 0 ? (
              <p className={styles.empty}>None logged this month.</p>
            ) : (
              <ul className={styles.list}>
                {month.direct_payments.map((payment) => (
                  <li key={payment.id} className={styles.entry}>
                    <div className={styles.entryHead}>
                      <span className={styles.entryName}>{payment.note}</span>
                      <span className={styles.amount}>{formatMoney(payment.amount)}</span>
                    </div>
                    <p className={styles.detail}>
                      Paid by {nameOf.get(payment.payer_id) ?? "someone"} on {dayLabel(payment.paid_on)}
                    </p>
                    <form action={removeDirectPayment}>
                      <input type="hidden" name="id" value={payment.id} />
                      <button type="submit" className={styles.quiet}>
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </FinancesFrame>
  );
}
