import styles from "../page.module.css";
import { householdToday, listPeople, monthLabel } from "../../../lib/finances/budget-year";
import { chosenMonth, dayLabel, listOpenedMonths, readMonth } from "../../../lib/finances/month";
import { formatMoney } from "../../../lib/finances/money";
import { paymentsMade } from "../../../lib/finances/overview";
import { FinancesFrame, financesViewer } from "../frame";

const SECTION = "Payments";

// REQ-104: every payment logged in the month the header shows — the
// month running, or the one History opened — newest first, with the
// count and total above. Read fresh on every visit, so a payment either
// of us logs shows straight away. Nothing here changes a payment.
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();
  const { month: asked } = await searchParams;
  const todayIso = householdToday();
  const [opened, people] = await Promise.all([listOpenedMonths(supabase), listPeople(supabase)]);
  const startsOn = chosenMonth(asked, opened, todayIso);
  const month = opened.includes(startsOn) ? await readMonth(supabase, startsOn) : null;
  const lines = month ? paymentsMade(month) : [];
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const monthName = monthLabel(startsOn).split(" ")[0];

  return (
    <FinancesFrame
      canManageMembers={canManageMembers}
      canManageBudget={canManageBudget}
      account={account}
      section={SECTION}
      month={{ startsOn, closed: Boolean(month?.closed_at) }}
    >
      <section className={styles.section} aria-labelledby="payments">
        <div className={styles.sectionHead}>
          <h2 id="payments" className={styles.sectionTitle}>
            Payments made
          </h2>
          <span className={styles.note}>
            {lines.length} payment{lines.length === 1 ? "" : "s"} · {formatMoney(total)} in {monthName}
          </span>
        </div>
        <div className={styles.card}>
          {lines.length === 0 ? (
            <p className={styles.empty}>No payments logged yet</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Paid by</th>
                  <th scope="col">Toward</th>
                  <th scope="col" className={styles.right}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className={styles.muted}>{dayLabel(line.on)}</td>
                    <th scope="row" className={styles.strong}>
                      {nameOf.get(line.payerId) ?? "Someone"}
                    </th>
                    <td className={styles.muted}>{line.toward}</td>
                    <td className={`${styles.right} ${styles.strong}`}>{formatMoney(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </FinancesFrame>
  );
}
