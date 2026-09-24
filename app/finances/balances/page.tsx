import {
  ACCOUNT_ORDER,
  ACCOUNTS,
  balanceTrend,
  CASH_GAP_FLAG,
  cashCheck,
  listBalances,
  startingPoint,
  type Account,
} from "../../../lib/finances/balances";
import { householdToday, listPeople, listSplits, monthLabel } from "../../../lib/finances/budget-year";
import { leftovers } from "../../../lib/finances/leftover";
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
import { Hint } from "../hint";
import { removeBalances } from "./actions";
import { BalanceChart } from "./chart";
import { BalancesForm } from "./forms";
import local from "./page.module.css";

const SECTION = "Balances";

const signed = (amount: number) => `${amount < 0 ? "−" : "+"}${formatMoney(Math.abs(amount))}`;

// The Balances section: enter each person's balances for a month
// (REQ-67), set their cash beside the month's leftover (REQ-65), and see
// how the balances have moved (REQ-68).
export default async function BalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { supabase, canManageMembers, account } = await financesViewer();
  const { month: asked } = await searchParams;
  const todayIso = householdToday();
  const [opened, people, splits, balances] = await Promise.all([
    listOpenedMonths(supabase),
    listPeople(supabase),
    listSplits(supabase),
    listBalances(supabase),
  ]);
  const known = [...new Set([...opened, ...balances.map((row) => row.month)])];
  const startsOn = chosenMonth(asked, known, todayIso);
  const month = opened.includes(startsOn) ? await readMonth(supabase, startsOn) : null;
  const shares = monthShares(month, splits, startsOn);
  const frame = {
    canManageMembers,
    account,
    section: SECTION,
    status: monthStatus(month, shares, todayIso),
    month: { current: startsOn, options: pickableMonths(known, todayIso) },
  };
  const nameOf = (userId: string) => people.find((person) => person.user_id === userId)?.name ?? "Someone";

  // The month's leftovers, once there's income to work them out from.
  const totals = month ? monthTotals(month, shares) : null;
  const left = month && totals && totals.people.length > 0 && month.income.length > 0 ? leftovers(totals, month.income).people : [];
  const checks = people.map((person) => {
    const cash = balances.find((row) => row.month === startsOn && row.user_id === person.user_id && row.account === "cash");
    // Someone not paid yet this month has no leftover to compare with.
    const leftover = left.find((row) => row.user_id === person.user_id && row.income > 0);
    return { person, hasCash: Boolean(cash), check: cashCheck(cash?.amount ?? null, leftover?.leftover ?? null) };
  });
  const entered = balances.some((row) => row.month === startsOn);
  const trend = balanceTrend(balances);

  return (
    <FinancesFrame {...frame}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="enter">
          <header className={styles.head}>
            <h2 id="enter" className={styles.name}>
              {monthLabel(startsOn)} balances
            </h2>
            <Hint text="Last month's figures fill in as a starting point. A blank box isn't saved, and shows as not entered." />
          </header>
          <div className={styles.entries}>
            {people.map((person) => {
              const starting: Partial<Record<Account, number>> = {};
              for (const account of ACCOUNT_ORDER) {
                const point = startingPoint(balances, startsOn, person.user_id, account);
                if (point) starting[account] = point.amount;
              }
              return (
                <BalancesForm
                  key={`${person.user_id}${balances.length}${balances.map((row) => row.amount).join()}`}
                  month={startsOn}
                  person={{ user_id: person.user_id, name: person.name }}
                  starting={starting}
                />
              );
            })}
            {entered ? (
              <form action={removeBalances}>
                <input type="hidden" name="month" value={startsOn} />
                <button type="submit" className={styles.quiet}>
                  Remove {monthLabel(startsOn)}&apos;s balances
                </button>
              </form>
            ) : null}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="cash-check">
          <header className={styles.head}>
            <h2 id="cash-check" className={styles.name}>
              Cash check
            </h2>
            <Hint
              text={`Your cash beside what the month says you have left. More than ${formatMoney(CASH_GAP_FLAG)} over is flagged.`}
            />
          </header>
          <div className={styles.entries}>
            <ul className={styles.list}>
              {checks.map(({ person, hasCash, check }) =>
                !check.checked ? (
                  <li key={person.user_id}>
                    <p className={styles.empty}>
                      {person.name}: no {hasCash ? "leftover yet" : "cash entered"}, so no check.
                    </p>
                  </li>
                ) : check.flagged ? (
                  <li key={person.user_id} className={styles.entry}>
                    <div className={styles.entryHead}>
                      <span className={styles.entryName}>{person.name}</span>
                      <span className={styles.amount}>{formatMoney(check.gap)} extra</span>
                    </div>
                    <p className={styles.detail}>
                      {formatMoney(check.cash)} cash, {formatMoney(check.leftover)} left. Move it to savings, or note
                      where it came from.
                    </p>
                  </li>
                ) : (
                  <li key={person.user_id}>
                    <p className={styles.empty}>
                      {person.name}: {formatMoney(check.cash)} cash, {formatMoney(check.leftover)} left
                      {check.gap > 0 ? ` (${formatMoney(check.gap)} over)` : ""}.
                    </p>
                  </li>
                ),
              )}
            </ul>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="trend">
          <header className={styles.head}>
            <h2 id="trend" className={styles.name}>
              Trend
            </h2>
            <Hint text="Each month's total and its change from the month before. Open a month for each account." />
          </header>
          <BalanceChart trend={trend} />
          <div className={styles.entries}>
            {trend.length === 0 ? (
              <p className={styles.empty}>No balances yet.</p>
            ) : (
              <ul className={styles.list}>
                {trend.map((row) => (
                  <li key={row.month} className={styles.entry}>
                    <div className={styles.entryHead}>
                      <span className={styles.entryName}>{monthLabel(row.month)}</span>
                      <span className={styles.amount}>{formatMoney(row.total)}</span>
                    </div>
                    <p className={styles.detail}>
                      {row.change === null
                        ? "First month"
                        : `${signed(row.change)} ${row.partial ? "on the same accounts" : "on the month before"}`}
                      {row.missing > 0 ? ` · ${row.missing} not entered` : ""}
                    </p>
                    <details className={local.accounts}>
                      <summary>Each account</summary>
                      <ul className={local.accounts}>
                        {row.accounts.map((entry) => (
                          <li key={`${entry.user_id}/${entry.account}`}>
                            {nameOf(entry.user_id)} · {ACCOUNTS[entry.account]}:{" "}
                            {entry.amount === null ? "not entered" : formatMoney(entry.amount)}
                            {entry.change === null ? "" : ` (${signed(entry.change)})`}
                          </li>
                        ))}
                      </ul>
                    </details>
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
