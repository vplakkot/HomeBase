import Link from "next/link";
import { LockIcon } from "../../components/icons";
import {
  householdToday,
  listPeople,
  listSplits,
  monthLabel,
  splitInForce,
} from "../../lib/finances/budget-year";
import { dueLabel, listBills } from "../../lib/finances/bills";
import {
  billEntered,
  chosenMonth,
  dueInMonth,
  listOpenedMonths,
  monthStatus,
  monthTotals,
  pickableMonths,
  readMonth,
} from "../../lib/finances/month";
import { formatMoney } from "../../lib/finances/money";
import { FinancesFrame, financesViewer } from "./frame";
import styles from "./page.module.css";

// The Finances module's home: the current month (docs/design/DESIGN.md §7).
// Until a budget year covers this month, the whole page is one card asking
// for setup: an admin gets Start setup, a member is told who to ask. Once
// it exists, the month in focus (REQ-92) shows who owes what — one card
// per person with their obligation, paid and outstanding (REQ-56, 58) —
// and the month's bills as rows (REQ-53, REQ-94): the month's own copy
// once it's opened, with paid of total and what's left, or the
// household's list before that. A month with a bill still to enter reads
// Incomplete. The verdict card and action items come with later batches.
export default async function FinancesPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
} = {}) {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();
  const todayIso = householdToday();
  const [splits, bills, people, opened] = await Promise.all([
    listSplits(supabase),
    listBills(supabase),
    listPeople(supabase),
    listOpenedMonths(supabase),
  ]);
  const asked = (await searchParams)?.month;
  const split = splitInForce(splits, todayIso);
  const startsOn = chosenMonth(asked, opened, todayIso);
  const picker = { current: startsOn, options: pickableMonths(opened, todayIso) };

  if (!split) {
    const admins = people.filter((person) => person.manages_budget).map((person) => person.name);
    return (
      <FinancesFrame
        canManageMembers={canManageMembers}
        account={account}
        status="No budget year"
        month={picker}
      >
        <section className={styles.firstRun} aria-labelledby="first-run">
          <h2 id="first-run" className={styles.firstRunTitle}>
            Set up your budget year
          </h2>
          {canManageBudget ? (
            <>
              <p className={styles.firstRunText}>
                Before anything else, choose how you split shared costs and add each
                person&apos;s income sources and the household&apos;s bills. You only do it
                once a year.
              </p>
              <Link href="/finances/budget-year" className={styles.firstRunButton}>
                Start setup
              </Link>
            </>
          ) : (
            <p className={styles.firstRunText}>
              Finances isn&apos;t set up yet.{" "}
              {admins.length === 1
                ? `${admins[0]}, your admin, needs to set up the budget year.`
                : admins.length > 1
                  ? `Ask ${admins.join(" or ")} to set up the budget year.`
                  : "Your admin needs to set up the budget year."}
            </p>
          )}
        </section>
      </FinancesFrame>
    );
  }

  const month = opened.includes(startsOn) ? await readMonth(supabase, startsOn) : null;
  // The month shown runs on the split that had started by then.
  const monthSplit = splitInForce(splits, startsOn);
  const totals = month ? monthTotals(month, monthSplit?.shares ?? []) : null;
  const rows = month
    ? month.bills.map((bill) => {
        const due = dueInMonth(bill.due_day, startsOn);
        const money = totals?.bills.find((row) => row.id === bill.id);
        return {
          id: bill.id,
          name: bill.name,
          note:
            bill.amount === null || !money
              ? due
              : `${due} · ${formatMoney(money.paid)} of ${formatMoney(money.total)}`,
          chip: !billEntered(bill)
            ? { text: "Not entered", done: false }
            : money && money.left <= 0
              ? { text: "Paid", done: true }
              : null,
          left: money && billEntered(bill) && money.left > 0 ? money.left : null,
        };
      })
    : bills.map((bill) => ({
        id: bill.id,
        name: bill.name,
        note: dueLabel(bill.due_day),
        chip: { text: "Not entered", done: false },
        left: null,
      }));
  const billsLeft = totals ? totals.bills.reduce((sum, row) => sum + Math.max(row.left, 0), 0) : 0;
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const sharesLine = split.shares
    .map((share) => `${nameOf.get(share.user_id) ?? "Someone"} ${share.percent}%`)
    .join(" · ");

  return (
    <FinancesFrame
      canManageMembers={canManageMembers}
      account={account}
      status={monthStatus(month)}
      month={picker}
    >
      <div className={styles.columns}>
        {totals && totals.people.length > 0 ? (
          <section className={styles.card} aria-labelledby="who-owes">
            <h2 id="who-owes" className={styles.cardTitle}>
              Who owes what
            </h2>
            <ul className={styles.people}>
              {totals.people.map((person) => {
                const name = nameOf.get(person.user_id) ?? "Someone";
                const settled = person.outstanding <= 0;
                const done = person.obligation > 0 ? Math.min(person.paid / person.obligation, 1) : 1;
                return (
                  <li key={person.user_id} className={styles.person}>
                    <div className={styles.personHead}>
                      <span className={styles.billName}>{name}</span>
                      {settled ? (
                        <span className={styles.paidUp}>Paid up</span>
                      ) : (
                        <span className={styles.owed}>{formatMoney(person.outstanding)}</span>
                      )}
                    </div>
                    <span className={styles.cardNote}>
                      {settled ? "" : "outstanding · "}paid {formatMoney(person.paid)} of{" "}
                      {formatMoney(person.obligation)}
                      {person.outstanding < 0 ? ` · ${formatMoney(-person.outstanding)} credit` : ""}
                    </span>
                    <span
                      className={styles.progress}
                      role="progressbar"
                      aria-label={`${name}'s share paid`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(done * 100)}
                    >
                      <span className={styles.progressFill} style={{ width: `${done * 100}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
            <details className={styles.workings}>
              <summary>How this was worked out</summary>
              <dl className={styles.sums}>
                <dt>Bills entered</dt>
                <dd>{formatMoney(totals.expenses)}</dd>
                <dt>Less personal charges</dt>
                <dd>− {formatMoney(totals.personal)}</dd>
                <dt>Plus one-time payments</dt>
                <dd>+ {formatMoney(totals.direct)}</dd>
                <dt>Shared</dt>
                <dd>{formatMoney(totals.sharedBase)}</dd>
              </dl>
              {totals.people.map((person) => {
                const name = nameOf.get(person.user_id) ?? "Someone";
                return (
                  <p key={person.user_id} className={styles.cardNote}>
                    {name}: {person.percent}% of {formatMoney(totals.sharedBase)} ={" "}
                    {formatMoney(person.share)}
                    {person.personal > 0
                      ? `, plus ${formatMoney(person.personal)} of their own personal charges = ${formatMoney(person.obligation)}`
                      : ""}{" "}
                    owed. Paid {formatMoney(person.paid)}
                    {person.fronted > 0 ? ` (${formatMoney(person.fronted)} of it in one-time payments)` : ""}
                    .
                  </p>
                );
              })}
              <p className={styles.cardNote}>
                Together that&apos;s {formatMoney(totals.expenses + totals.direct)}: the bills plus the
                one-time payments.
              </p>
            </details>
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="bills">
          <div className={styles.cardHead}>
            <div className={styles.billsHead}>
            <h2 id="bills" className={styles.cardTitle}>
              Bills
            </h2>
            {totals ? (
              <span className={styles.cardNote}>
                {formatMoney(billsLeft)} of {formatMoney(totals.expenses)} left
              </span>
            ) : null}
          </div>
            <Link href={`/finances/monthly-entry?month=${startsOn.slice(0, 7)}`} className={styles.button}>
              {month ? "Enter bills" : `Open ${monthLabel(startsOn)}`}
            </Link>
          </div>
          {rows.length === 0 ? (
            <p className={styles.cardNote}>No bills in the list yet.</p>
          ) : (
            <ul className={styles.rows}>
              {rows.map((row) => (
                <li key={row.id} className={styles.billRow}>
                  <span className={styles.billText}>
                    <span className={styles.billName}>{row.name}</span>
                    <span className={styles.cardNote}>{row.note}</span>
                  </span>
                  {row.chip ? (
                    <span className={row.chip.done ? styles.paidChip : styles.status}>{row.chip.text}</span>
                  ) : row.left !== null ? (
                    <span className={styles.owed}>{formatMoney(row.left)} left</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={styles.card} aria-labelledby="admin">
        <h2 id="admin" className={styles.cardTitle}>
          Admin
        </h2>
        <div className={styles.billRow}>
          <span className={styles.billText}>
            <span className={styles.billName}>Budget year</span>
            <span className={styles.cardNote}>
              From {monthLabel(split.effective_from)} · {sharesLine}
            </span>
          </span>
          {canManageBudget ? (
            <Link href="/finances/budget-year" className={styles.button}>
              Open
            </Link>
          ) : (
            <span className={styles.locked}>
              <LockIcon />
              Admin only
            </span>
          )}
        </div>
      </section>
    </FinancesFrame>
  );
}
