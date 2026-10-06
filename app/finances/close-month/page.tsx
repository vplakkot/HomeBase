import { redirect } from "next/navigation";
import { ButtonLink, buttonClass } from "../../../components/button";
import styles from "../../../components/cards.module.css";
import { householdToday, listPeople, listSplits, monthLabel, monthStart } from "../../../lib/finances/budget-year";
import {
  billEntered,
  chosenMonth,
  isSquared,
  listOpenedMonths,
  monthShares,
  monthTotals,
  readMonth,
} from "../../../lib/finances/month";
import { formatMoney } from "../../../lib/finances/money";
import { closeMonthWithBalance } from "../actions";
import { FinancesFrame, financesViewer } from "../frame";

// REQ-59: an admin closes a month by hand, on purpose, whatever state it is
// in (Vin, 2026-10-06: a squared month, or one still running, can be closed
// by hand too, not only one with a balance). The page says what that does:
// who still owes what, or that everything is paid, and that it locks the
// month; nothing carries into the next. Reached from the "ended, not
// squared" and "squared" action items and from Close the month on Finances
// home. Anyone else, or a month that is already closed, goes back to
// Finances home.
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
  if (!canManageBudget || !month || month.closed_at) {
    redirect("/finances");
  }
  const totals = monthTotals(month, monthShares(month, splits, startsOn));
  const squared = isSquared(month, totals);
  const stillRunning = startsOn >= monthStart(todayIso);
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const owing = totals.people
    .filter((person) => person.outstanding > 0)
    .map((person) => `${nameOf.get(person.user_id) ?? "Someone"} still owes ${formatMoney(person.outstanding)}`);
  const allEntered = month.bills.every(billEntered);
  const at = startsOn.slice(0, 7);
  const label = monthLabel(startsOn);
  const heading = owing.length > 0 ? `Close ${label} with a balance` : `Close ${label}`;

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
              {heading}
            </h2>
          </header>
          <div className={styles.addBlock}>
            {allEntered ? (
              <>
                <p className={styles.empty}>
                  {owing.length > 0
                    ? `${owing.join(" · ")}. Closing records that and locks ${label}; nothing carries into next month.`
                    : squared
                      ? `Everything is paid. Closing locks ${label}: bills and payments can't change until you reopen it.`
                      : `Nobody owes anything. Closing locks ${label}: bills and payments can't change until you reopen it.`}
                  {stillRunning ? ` ${label} isn't over yet, so nothing more can be added to it.` : ""}
                </p>
                <form action={closeMonthWithBalance}>
                  <input type="hidden" name="monthId" value={month.id} />
                  <button type="submit" className={buttonClass}>
                    Close {label}
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
