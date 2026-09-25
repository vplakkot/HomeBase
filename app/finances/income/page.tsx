import Link from "next/link";
import { householdToday, listPeople, listSplits } from "../../../lib/finances/budget-year";
import { listIncomeHistory } from "../../../lib/finances/income";
import { expectedPaychecks, INCOME_KINDS } from "../../../lib/finances/leftover";
import {
  chosenMonth,
  dayLabel,
  listOpenedMonths,
  monthShares,
  readMonth,
} from "../../../lib/finances/month";
import { formatMoney } from "../../../lib/finances/money";
import styles from "../../../components/cards.module.css";
import { FinancesFrame, financesViewer } from "../frame";
import { Hint } from "../../../components/hint";
import { removeIncome } from "./actions";
import { ConfirmPaycheckForm, IncomeForm } from "./forms";

const SECTION = "Income";

// The Income section (REQ-60): the money that actually landed in the
// month. Paychecks the income setup expects are listed to confirm rather
// than typed; anything else — ESPP or RSU sales, a bonus — is added by
// hand. A month that has closed and ended can't change.
export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();
  const { month: asked } = await searchParams;
  const todayIso = householdToday();
  const [opened, people, splits, sources] = await Promise.all([
    listOpenedMonths(supabase),
    listPeople(supabase),
    listSplits(supabase),
    listIncomeHistory(supabase),
  ]);
  const startsOn = chosenMonth(asked, opened, todayIso);
  const month = opened.includes(startsOn) ? await readMonth(supabase, startsOn) : null;
  const frame = {
    canManageMembers,
    account,
    section: SECTION,
    canManageBudget,
    month: { startsOn, closed: Boolean(month?.closed_at) },
  };

  if (!month) {
    return (
      <FinancesFrame {...frame}>
        <div className={styles.cards}>
          <section className={styles.card} aria-labelledby="no-month">
            <header className={styles.head}>
              <h2 id="no-month" className={styles.name}>
                Month not open yet
              </h2>
            </header>
            <div className={styles.addBlock}>
              <Link href={`/finances/monthly-entry?month=${startsOn.slice(0, 7)}`} className={styles.primary}>
                Go to Monthly entry
              </Link>
            </div>
          </section>
        </div>
      </FinancesFrame>
    );
  }

  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const [year, monthNumber] = month.starts_on.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const lastDay = todayIso < monthEnd ? todayIso : monthEnd;
  // A squared month can close before it's out, and pay can still land
  // after; income locks once the month is closed and over.
  const locked = month.closed_at !== null && todayIso > monthEnd;
  const expected = locked ? [] : expectedPaychecks(sources, startsOn, todayIso, month.income);

  return (
    <FinancesFrame {...frame}>
      <div className={styles.cards}>
        {expected.length > 0 ? (
          <section className={styles.card} aria-labelledby="expected">
            <header className={styles.head}>
              <h2 id="expected" className={styles.name}>
                Paychecks to confirm
              </h2>
              <Hint text="From the income sources in Budget year. Change the amount if what landed was different." />
            </header>
            <div className={styles.entries}>
              <ul className={styles.list}>
                {expected.map((paycheck) => (
                  <li key={`${paycheck.source_id}/${paycheck.payday}`} className={styles.todo}>
                    <div className={styles.entryHead}>
                      <span className={styles.entryName}>
                        {nameOf.get(paycheck.owner_id) ?? "Someone"} · {paycheck.name}
                      </span>
                    </div>
                    <p className={styles.detail}>{dayLabel(paycheck.payday)}</p>
                    <ConfirmPaycheckForm monthId={month.id} paycheck={paycheck} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="received">
          <header className={styles.head}>
            <h2 id="received" className={styles.name}>
              Received this month
            </h2>
            <Hint text="Only money that landed. ESPP or RSU shares you kept aren't income; they belong in balances." />
          </header>
          <div className={styles.entries}>
            <ul className={styles.list}>
              {locked ? null : (
                <li className={styles.todo}>
                  <span className={styles.entryName}>New income</span>
                  <IncomeForm monthId={month.id} people={people} firstDay={month.starts_on} lastDay={lastDay} />
                </li>
              )}
              {month.income.map((row) => {
                const who = nameOf.get(row.owner_id) ?? "Someone";
                return (
                  <li key={row.id} className={styles.entry}>
                    <div className={styles.entryHead}>
                      <span className={styles.entryName}>
                        {who} · {INCOME_KINDS[row.kind]}
                      </span>
                      <span className={styles.amount}>{formatMoney(row.amount)}</span>
                    </div>
                    <p className={styles.detail}>
                      {dayLabel(row.received_on)}
                      {row.note ? ` · ${row.note}` : ""}
                    </p>
                    {locked ? null : (
                      <form action={removeIncome}>
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          className={styles.quiet}
                          aria-label={`Remove ${who}'s ${formatMoney(row.amount)} ${INCOME_KINDS[row.kind]}`}
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>
    </FinancesFrame>
  );
}
