import { redirect } from "next/navigation";
import { ButtonLink, buttonClass } from "../../../components/button";
import styles from "../../../components/cards.module.css";
import { householdToday, listPeople, listSplits, monthLabel, monthStart } from "../../../lib/finances/budget-year";
import { billEntered, chosenMonth, listOpenedMonths, monthShares, monthTotals, readMonth } from "../../../lib/finances/month";
import { formatMoney } from "../../../lib/finances/money";
import { closeMonthWithBalance } from "../actions";
import { FinancesFrame, financesViewer } from "../frame";

// REQ-59 behind the "ended, not squared" action item (REQ-103: Close
// month appears only as an action item). An admin sees who still owes
// what and closes the month on purpose; nothing carries into the next.
// Anyone else, or a month that isn't over or is already closed, goes back
// to Finances home.
export default async function CloseMonthPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();
  const { month: asked } = await searchParams;
  const todayIso = householdToday();
  const [opened, people, splits] = await Promise.all([
    listOpenedMonths(supabase),
    listPeople(supabase),
    listSplits(supabase),
  ]);
  const startsOn = chosenMonth(asked, opened, todayIso);
  const month = opened.includes(startsOn) ? await readMonth(supabase, startsOn) : null;
  if (!canManageBudget || !month || month.closed_at || startsOn >= monthStart(todayIso)) {
    redirect("/finances");
  }
  const totals = monthTotals(month, monthShares(month, splits, startsOn));
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const owing = totals.people
    .filter((person) => person.outstanding > 0)
    .map((person) => `${nameOf.get(person.user_id) ?? "Someone"} still owes ${formatMoney(person.outstanding)}`);
  const allEntered = month.bills.every(billEntered);
  const at = startsOn.slice(0, 7);

  return (
    <FinancesFrame
      canManageMembers={canManageMembers}
      canManageBudget={canManageBudget}
      account={account}
      section="Close month"
      month={{ startsOn, closed: false }}
    >
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="close">
          <header className={styles.head}>
            <h2 id="close" className={styles.name}>
              Close {monthLabel(startsOn)} with a balance
            </h2>
          </header>
          <div className={styles.addBlock}>
            {allEntered ? (
              <>
                <p className={styles.empty}>
                  {owing.join(" · ") || "Nobody owes anything, but a bill isn't paid in full"}. Closing records that and
                  locks {monthLabel(startsOn)}; nothing carries into next month.
                </p>
                <form action={closeMonthWithBalance}>
                  <input type="hidden" name="monthId" value={month.id} />
                  <button type="submit" className={buttonClass}>
                    Close {monthLabel(startsOn)}
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className={styles.empty}>Enter every bill first.</p>
                <ButtonLink href={`/finances/monthly-entry?month=${at}`}>Enter numbers</ButtonLink>
              </>
            )}
          </div>
        </section>
      </div>
    </FinancesFrame>
  );
}
