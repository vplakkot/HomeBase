import Link from "next/link";
import { buttonClass } from "../../../components/button";
import { ChevronRightIcon } from "../../../components/icons";
import styles from "../page.module.css";
import { budgetYearMonthsSoFar, householdToday, monthLabel, monthStart } from "../../../lib/finances/budget-year";
import { listMonthsClosed, type MonthListed } from "../../../lib/finances/month";
import { addPastMonth } from "../monthly-entry/actions";
import { FinancesFrame, financesViewer } from "../frame";

const SECTION = "History";

// How a month gone by stands. REQ-148: one added later says so too.
function standing(month: MonthListed): string {
  const state = month.settled ? "Settled" : month.closed ? "Closed" : "Open";
  return month.addedLater ? `${state} · Added later` : state;
}

// Where Previous months goes (REQ-102): every month there has been, newest
// first, each opening Finances home on that month. A month gone by says
// whether it was closed. REQ-148: every month of this budget year so far
// is listed, and one never opened is "Not entered", with Add to fill it
// in on Monthly entry. Its layout is a placeholder until History gets
// its own requirement.
export default async function HistoryPage() {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();
  const todayIso = householdToday();
  const opened = await listMonthsClosed(supabase);
  const byMonth = new Map(opened.map((month) => [month.startsOn, month]));
  const current = monthStart(todayIso);
  const months = [...new Set([...budgetYearMonthsSoFar(todayIso), ...opened.map((month) => month.startsOn)])]
    .sort()
    .reverse();

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
          {months.map((startsOn) => {
            const month = byMonth.get(startsOn);
            if (!month && startsOn !== current) {
              return (
                <li key={startsOn} className={styles.linkRow}>
                  <span className={styles.strong}>{monthLabel(startsOn)}</span>
                  <span className={styles.note}>Not entered</span>
                  <form action={addPastMonth}>
                    <input type="hidden" name="month" value={startsOn.slice(0, 7)} />
                    <button type="submit" className={buttonClass} aria-label={`Add ${monthLabel(startsOn)}`}>
                      Add
                    </button>
                  </form>
                </li>
              );
            }
            return (
              <li key={startsOn}>
                <Link href={`/finances?month=${startsOn.slice(0, 7)}`} className={styles.linkRow}>
                  <span className={styles.strong}>{monthLabel(startsOn)}</span>
                  <span className={styles.note}>
                    {startsOn === current ? "This month" : month ? standing(month) : "Open"}
                  </span>
                  <ChevronRightIcon />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </FinancesFrame>
  );
}
