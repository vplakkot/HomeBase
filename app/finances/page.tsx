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
  pickableMonths,
  readMonth,
} from "../../lib/finances/month";
import { formatMoney } from "../../lib/finances/money";
import { FinancesFrame, financesViewer } from "./frame";
import styles from "./page.module.css";

// The Finances module's home: the current month (docs/design/DESIGN.md §7).
// Until a budget year covers this month, the whole page is one card asking
// for setup: an admin gets Start setup, a member is told who to ask. Once
// it exists, the month's bills show as rows (REQ-53, REQ-94): the month's
// own copy once it's opened, the household's list before that. A month
// with a bill still to enter reads Incomplete.
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
  const rows = month
    ? month.bills.map((bill) => ({
        id: bill.id,
        name: bill.name,
        note: bill.amount === null
          ? dueInMonth(bill.due_day, startsOn)
          : `${dueInMonth(bill.due_day, startsOn)} · ${formatMoney(bill.amount)}`,
        entered: billEntered(bill),
      }))
    : bills.map((bill) => ({ id: bill.id, name: bill.name, note: dueLabel(bill.due_day), entered: false }));
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
      <section className={styles.card} aria-labelledby="bills">
        <div className={styles.cardHead}>
          <h2 id="bills" className={styles.cardTitle}>
            Bills
          </h2>
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
                {row.entered ? null : <span className={styles.status}>Not entered</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

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
