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
import { FinancesFrame, financesViewer } from "./frame";
import styles from "./page.module.css";

// The Finances module's home: the current month (docs/design/DESIGN.md §7).
// Until a budget year covers this month, the whole page is one card asking
// for setup: an admin gets Start setup, a member is told who to ask. Once
// it exists, the bills show as rows. Nothing can be entered against them
// until monthly entry arrives, so the month reads as incomplete.
export default async function FinancesPage() {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();
  const todayIso = householdToday();
  const [splits, bills, people] = await Promise.all([
    listSplits(supabase),
    listBills(supabase),
    listPeople(supabase),
  ]);
  const split = splitInForce(splits, todayIso);

  if (!split) {
    const admins = people.filter((person) => person.manages_budget).map((person) => person.name);
    return (
      <FinancesFrame canManageMembers={canManageMembers} account={account} status="No budget year">
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

  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const sharesLine = split.shares
    .map((share) => `${nameOf.get(share.user_id) ?? "Someone"} ${share.percent}%`)
    .join(" · ");

  return (
    <FinancesFrame canManageMembers={canManageMembers} account={account} status="Incomplete">
      <section className={styles.card} aria-labelledby="bills">
        <h2 id="bills" className={styles.cardTitle}>
          Bills
        </h2>
        {bills.length === 0 ? (
          <p className={styles.cardNote}>No bills in the list yet.</p>
        ) : (
          <ul className={styles.rows}>
            {bills.map((bill) => (
              <li key={bill.id} className={styles.billRow}>
                <span className={styles.billText}>
                  <span className={styles.billName}>{bill.name}</span>
                  <span className={styles.cardNote}>{dueLabel(bill.due_day)}</span>
                </span>
                <span className={styles.status}>Not entered</span>
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
