import Link from "next/link";
import { ChevronRightIcon } from "../../../components/icons";
import styles from "../page.module.css";
import { householdToday, monthLabel, monthStart } from "../../../lib/finances/budget-year";
import { listMonthsClosed } from "../../../lib/finances/month";
import { FinancesFrame, financesViewer } from "../frame";

const SECTION = "History";

// Where Previous months goes (REQ-102): every month there has been, newest
// first, each opening Finances home on that month. A month gone by says
// whether it was closed. Its layout is a placeholder until History gets
// its own requirement.
export default async function HistoryPage() {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();
  const todayIso = householdToday();
  const opened = await listMonthsClosed(supabase);
  const closed = new Set(opened.filter((month) => month.closed).map((month) => month.startsOn));
  const current = monthStart(todayIso);
  const months = [...new Set([current, ...opened.map((month) => month.startsOn)])].sort().reverse();

  return (
    <FinancesFrame
      canManageMembers={canManageMembers}
      canManageBudget={canManageBudget}
      account={account}
      section={SECTION}
    >
      <section className={styles.section} aria-labelledby="months">
        <div className={styles.sectionHead}>
          <h2 id="months" className={styles.sectionTitle}>
            Months
          </h2>
        </div>
        <ul className={`${styles.card} ${styles.rows}`}>
          {months.map((startsOn) => (
            <li key={startsOn}>
              <Link href={`/finances?month=${startsOn.slice(0, 7)}`} className={styles.linkRow}>
                <span className={styles.strong}>{monthLabel(startsOn)}</span>
                <span className={styles.note}>
                  {startsOn === current ? "This month" : closed.has(startsOn) ? "Closed" : "Open"}
                </span>
                <ChevronRightIcon />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </FinancesFrame>
  );
}
