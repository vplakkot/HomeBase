import Link from "next/link";
import { householdToday, listPeople, listSplits, monthLabel, type Split } from "../../../lib/finances/budget-year";
import { leftovers } from "../../../lib/finances/leftover";
import {
  chosenMonth,
  listOpenedMonths,
  monthShares,
  monthStatus,
  monthTotals,
  pickableMonths,
  readMonth,
  type Month,
} from "../../../lib/finances/month";
import { formatMoney } from "../../../lib/finances/money";
import { nothingToSaveReasons, savingsPlan } from "../../../lib/finances/savings";
import styles from "../budget-year/page.module.css";
import { FinancesFrame, financesViewer } from "../frame";
import { Hint } from "../hint";
import { removeSavings } from "./actions";
import { SavingsForm } from "./forms";
import local from "./page.module.css";

const SECTION = "Savings";

// What a month made available to save (REQ-63, REQ-64), or null when
// there's nobody on it or no income logged yet.
function planFor(month: Month, splits: Split[]) {
  const totals = monthTotals(month, monthShares(month, splits, month.starts_on));
  if (totals.people.length === 0 || month.income.length === 0) return null;
  return savingsPlan(leftovers(totals, month.income).people);
}

// The Savings section: what the month allows into joint and each
// person's own (REQ-63, REQ-64), what was actually put away (REQ-66),
// and, for closed months, the two side by side.
export default async function SavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { supabase, canManageMembers, account } = await financesViewer();
  const { month: asked } = await searchParams;
  const todayIso = householdToday();
  const [opened, people, splits] = await Promise.all([
    listOpenedMonths(supabase),
    listPeople(supabase),
    listSplits(supabase),
  ]);
  const startsOn = chosenMonth(asked, opened, todayIso);
  const months = (await Promise.all(opened.map((day) => readMonth(supabase, day)))).filter(
    (month): month is Month => month !== null,
  );
  const month = months.find((row) => row.starts_on === startsOn) ?? null;
  const frame = {
    canManageMembers,
    account,
    section: SECTION,
    status: monthStatus(month, monthShares(month, splits, startsOn), todayIso),
    month: { current: startsOn, options: pickableMonths(opened, todayIso) },
  };
  const nameOf = (userId: string) => people.find((person) => person.user_id === userId)?.name ?? "Someone";
  const closed = months.filter((row) => row.closed_at);

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

  const plan = planFor(month, splits);
  const onMonth = month.closed_at
    ? month.people.map((person) => person.user_id)
    : monthTotals(month, monthShares(month, splits, startsOn)).people.map((person) => person.user_id);

  return (
    <FinancesFrame {...frame}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="available">
          <header className={styles.head}>
            <h2 id="available" className={styles.name}>
              Available to save
            </h2>
            <Hint text="Each of you puts half the lower leftover into joint, rounded down to the dollar. The rest of your leftover is yours. Leftover excludes personal card spend." />
          </header>
          {!plan ? (
            <div className={styles.addBlock}>
              <Link href={`/finances/income?month=${startsOn.slice(0, 7)}`} className={styles.primary}>
                Log income
              </Link>
            </div>
          ) : (
            <div className={styles.entries}>
              {plan.joint > 0 ? (
                <ul className={styles.list}>
                  {plan.people.map((person) => (
                    <li key={person.user_id} className={styles.entry}>
                      <div className={styles.entryHead}>
                        <span className={styles.entryName}>{nameOf(person.user_id)}</span>
                        <span className={styles.amount}>{formatMoney(person.toJoint)} to joint</span>
                      </div>
                      <p className={styles.detail}>{formatMoney(person.yours)} yours</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p className={styles.total}>Nothing to save this month</p>
                  {nothingToSaveReasons(plan, nameOf).map((reason) => (
                    <p key={reason} className={styles.empty}>
                      {reason}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </section>

        {onMonth.length > 0 ? (
          <section className={styles.card} aria-labelledby="saved">
            <header className={styles.head}>
              <h2 id="saved" className={styles.name}>
                What you saved
              </h2>
              <Hint text="What actually went into joint savings, and what each of you saved on your own. You can fill it in after the month ends." />
            </header>
            <div className={styles.entries}>
              <SavingsForm
                key={month.savings.map((row) => `${row.user_id}${row.to_joint}${row.own}`).join()}
                monthId={month.id}
                people={onMonth.map((userId) => ({ user_id: userId, name: nameOf(userId) }))}
                recorded={month.savings}
              />
              {month.savings.length > 0 ? (
                <form action={removeSavings}>
                  <input type="hidden" name="monthId" value={month.id} />
                  <button type="submit" className={styles.quiet}>
                    Remove {monthLabel(month.starts_on)}&apos;s record
                  </button>
                </form>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="closed-months">
          <header className={styles.head}>
            <h2 id="closed-months" className={styles.name}>
              Closed months
            </h2>
            <Hint text="What each closed month made available, beside what you recorded." />
          </header>
          <div className={styles.entries}>
            {closed.length === 0 ? (
              <p className={styles.empty}>No closed months yet.</p>
            ) : (
              <ul className={styles.list}>
                {closed.map((row) => {
                  const said = planFor(row, splits);
                  const recordedJoint = row.savings.reduce((sum, saved) => sum + Math.round(saved.to_joint * 100), 0) / 100;
                  return (
                    <li key={row.id} className={styles.entry}>
                      <div className={styles.entryHead}>
                        <span className={styles.entryName}>{monthLabel(row.starts_on)}</span>
                        <span className={styles.amount}>
                          {row.savings.length === 0
                            ? "Not recorded"
                            : `${formatMoney(recordedJoint)} of ${formatMoney(said?.joint ?? 0)} to joint`}
                        </span>
                      </div>
                      {row.savings.length > 0
                        ? row.people.map((person) => {
                            const saved = row.savings.find((entry) => entry.user_id === person.user_id);
                            const available = said?.people.find((entry) => entry.user_id === person.user_id);
                            const toJoint = saved?.to_joint ?? 0;
                            const own = saved?.own ?? 0;
                            const sayJoint = available?.toJoint ?? 0;
                            const sayOwn = available?.yours ?? 0;
                            const differs = toJoint !== sayJoint || own !== sayOwn;
                            return (
                              <p key={person.user_id} className={differs ? `${styles.detail} ${local.diverged}` : styles.detail}>
                                {nameOf(person.user_id)}: {formatMoney(toJoint)} of {formatMoney(sayJoint)} into joint ·{" "}
                                {formatMoney(own)} of {formatMoney(sayOwn)} saved on their own
                                {differs ? " · differs" : ""}
                              </p>
                            );
                          })
                        : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </FinancesFrame>
  );
}
