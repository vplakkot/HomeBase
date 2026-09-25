import Link from "next/link";
import { ButtonLink, buttonClass } from "../../components/button";
import { householdToday, listPeople, listSplits, monthLabel, splitInForce } from "../../lib/finances/budget-year";
import { financeItems } from "../../lib/finances/action-items";
import { listBills } from "../../lib/finances/bills";
import { billEntered, chosenMonth, dayLabel, listOpenedMonths, monthShares, monthTotals, readMonth } from "../../lib/finances/month";
import { formatMoney } from "../../lib/finances/money";
import { monthSummary, progress } from "../../lib/finances/overview";
import { acknowledge, readFinanceSnapshot } from "../../lib/finances/snapshot";
import { acknowledgeItem } from "./actions";
import { FinancesFrame, financesViewer } from "./frame";
import styles from "./page.module.css";

// The Finances module's home: one month, the one running unless History
// asked for another (docs/design/DESIGN.md §6–§7, REQ-103). Top to
// bottom: the module's action items, each with its button (REQ-93; "Close
// month" lives only there); the summary — still to pay, the bills, paid
// so far and the split; who owes what, one card per person (REQ-56, 58);
// and the bills with due dates and progress. Every card is white with a
// module-colour border, and status is plain text. Until a split covers
// this month, the page is one card asking for setup. Savings is paused,
// so its verdict card isn't shown. Opening a month someone else entered
// clears its "numbers are ready" item (REQ-93).
export default async function FinancesPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
} = {}) {
  const { supabase, canManageMembers, canManageBudget, account, userId } = await financesViewer();
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
  const frame = { canManageMembers, canManageBudget, account };

  if (!split) {
    const admins = people.filter((person) => person.manages_budget).map((person) => person.name);
    return (
      <FinancesFrame {...frame} month={{ startsOn, closed: false }}>
        <section className={styles.card} aria-labelledby="first-run">
          <h2 id="first-run" className={styles.cardTitle}>
            Set up your budget year
          </h2>
          {canManageBudget ? (
            <>
              <p className={styles.note}>
                Before anything else, choose how you split shared costs and add each person&apos;s income
                sources and the household&apos;s bills. You only do it once a year.
              </p>
              <ButtonLink href="/finances/budget-year">Start setup</ButtonLink>
            </>
          ) : (
            <p className={styles.note}>
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
  // REQ-93: "numbers are ready" clears once the person who didn't enter
  // them has opened the month. Losing this only leaves the item up.
  if (
    month &&
    month.bills.length > 0 &&
    month.bills.every(billEntered) &&
    month.bills.some((bill) => bill.entered_by && bill.entered_by !== userId)
  ) {
    await acknowledge(supabase, `ready:${startsOn}`).catch((reason) => console.error(reason));
  }
  const items = financeItems(await readFinanceSnapshot(supabase, todayIso, people), userId);

  // The month shown runs on the split that had started by then, or the
  // percentages written on it when it closed.
  const shares = monthShares(month, splits, startsOn);
  const totals = month ? monthTotals(month, shares) : null;
  const summary = month && totals ? monthSummary(month, totals, todayIso) : null;
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const percentages = (list: { user_id: string; percent: number }[]) =>
    list.map((share) => `${nameOf.get(share.user_id) ?? "Someone"} ${share.percent}%`).join(" · ");
  // What was still owed when the month closed, and by whom (REQ-59).
  const leftOwing = month?.closed_at ? month.people.filter((person) => person.outstanding > 0) : [];
  const monthName = monthLabel(startsOn).split(" ")[0];
  const at = startsOn.slice(0, 7);

  return (
    <FinancesFrame {...frame} month={{ startsOn, closed: Boolean(month?.closed_at) }}>
      {items.length > 0 ? (
        <section className={styles.section} aria-labelledby="action-items">
          <div className={styles.sectionHead}>
            <h2 id="action-items" className={styles.sectionTitle}>
              Action items <span className={styles.count}>{items.length}</span>
            </h2>
          </div>
          <ul className={`${styles.card} ${styles.rows}`}>
            {items.map((item) => (
              <li key={item.key} className={styles.itemRow}>
                <span className={styles.itemText}>
                  <span className={styles.strong}>{item.text}</span>
                  <span className={styles.note}>{item.detail}</span>
                </span>
                {item.button === "Acknowledge" ? (
                  <form action={acknowledgeItem}>
                    <input type="hidden" name="key" value={item.key} />
                    <button type="submit" className={buttonClass}>
                      Acknowledge
                    </button>
                  </form>
                ) : (
                  <ButtonLink href={item.href}>{item.button}</ButtonLink>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary ? (
        <section className={styles.card} aria-labelledby="summary">
          <div className={styles.summaryTop}>
            <div className={styles.figureBlock}>
              <h2 id="summary" className={styles.label}>
                Still to pay in {monthName}
              </h2>
              <span className={styles.bigFigure}>{formatMoney(summary.stillToPay)}</span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt className={styles.note}>Bills this month</dt>
                <dd className={styles.fact}>{formatMoney(summary.bills)}</dd>
              </div>
              <div>
                <dt className={styles.note}>Paid so far</dt>
                <dd className={styles.fact}>{formatMoney(summary.paid)}</dd>
              </div>
              <div>
                <dt className={styles.note}>Split</dt>
                <dd className={styles.fact}>{shares.map((share) => share.percent).join(" / ")}</dd>
              </div>
            </dl>
          </div>
          <Bar percent={summary.percentPaid} thick />
          <p className={styles.note}>
            {summary.percentPaid}% paid
            {summary.overdue > 0 ? ` · ${summary.overdue} bill${summary.overdue === 1 ? "" : "s"} overdue` : ""}
          </p>
        </section>
      ) : null}

      {month?.closed_at ? (
        <section className={styles.card} aria-label="Closed month">
          <p className={styles.note}>
            Closed {dayLabel(month.closed_at.slice(0, 10))}
            {month.closed_automatically ? ", squared" : ""} · split from{" "}
            {month.split_from ? monthLabel(month.split_from) : "no split"}: {percentages(month.people)}
          </p>
          {leftOwing.map((person) => {
            const name = nameOf.get(person.user_id) ?? "Someone";
            return (
              <p key={person.user_id} className={styles.note}>
                Closed with {formatMoney(person.outstanding)} of {name}&apos;s unpaid. When it shows up on next
                month&apos;s statement, declare it as {name}&apos;s personal charge so it isn&apos;t split again.
              </p>
            );
          })}
        </section>
      ) : null}

      {totals && totals.people.length > 0 ? (
        <section className={styles.section} aria-labelledby="who-owes">
          <div className={styles.sectionHead}>
            <h2 id="who-owes" className={styles.sectionTitle}>
              Who owes what
            </h2>
          </div>
          <ul className={styles.people}>
            {totals.people.map((person) => {
              const settled = person.outstanding <= 0;
              return (
                <li key={person.user_id} className={`${styles.card} ${styles.person}`}>
                  <span className={styles.personHead}>
                    <span className={styles.strong}>{nameOf.get(person.user_id) ?? "Someone"}</span>
                    <span className={styles.note}>{person.percent}% share</span>
                  </span>
                  <span className={styles.figureLine}>
                    <span className={styles.personFigure}>
                      {settled ? "Paid" : formatMoney(person.outstanding)}
                    </span>
                    {settled ? null : <span className={styles.note}>outstanding</span>}
                  </span>
                  <Bar percent={progress(person.paid, person.obligation)} />
                  <span className={styles.note}>
                    Paid {formatMoney(person.paid)} of {formatMoney(person.obligation)}
                    {person.outstanding < 0 ? ` · ${formatMoney(-person.outstanding)} credit` : ""}
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
              <dt>Plus One-time Payments</dt>
              <dd>+ {formatMoney(totals.direct)}</dd>
              <dt>Shared</dt>
              <dd>{formatMoney(totals.sharedBase)}</dd>
            </dl>
            {totals.people.map((person) => (
              <p key={person.user_id} className={styles.note}>
                {nameOf.get(person.user_id) ?? "Someone"}: {person.percent}% of {formatMoney(totals.sharedBase)} ={" "}
                {formatMoney(person.share)}
                {person.personal > 0
                  ? `, plus ${formatMoney(person.personal)} of their own personal charges = ${formatMoney(person.obligation)}`
                  : ""}{" "}
                owed. Paid {formatMoney(person.paid)}
                {person.fronted > 0 ? ` (${formatMoney(person.fronted)} of it in One-time Payments)` : ""}.
              </p>
            ))}
            <p className={styles.note}>
              Together that&apos;s {formatMoney(totals.expenses + totals.direct)}: the bills plus the One-time
              Payments.
            </p>
          </details>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="bills">
        <div className={styles.sectionHead}>
          <h2 id="bills" className={styles.sectionTitle}>
            Bills
          </h2>
          <Link href={`/finances/monthly-entry?month=${at}`} className={styles.link}>
            Edit in Monthly entry
          </Link>
        </div>
        <div className={styles.card}>
          {summary ? (
            summary.rows.length === 0 ? (
              <p className={styles.empty}>No bills this month.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Bill</th>
                    <th scope="col">Due</th>
                    <th scope="col">Progress</th>
                    <th scope="col" className={styles.right}>
                      Left
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className={styles.strong}>
                        {row.name}
                      </th>
                      <td className={row.overdue ? styles.urgent : styles.muted}>
                        {dayLabel(row.due)}
                        {row.overdue ? " · Overdue" : ""}
                      </td>
                      <td>
                        {row.entered ? (
                          <span className={styles.progressCell}>
                            <Bar percent={progress(row.paid, row.total)} />
                            <span className={styles.note}>
                              {formatMoney(Math.min(row.paid, row.total))} of {formatMoney(row.total)}
                            </span>
                          </span>
                        ) : (
                          <span className={styles.note}>Not entered</span>
                        )}
                      </td>
                      <td className={`${styles.right} ${styles.strong}`}>
                        {!row.entered ? "—" : row.left > 0 ? formatMoney(row.left) : "Paid"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : bills.length === 0 ? (
            <p className={styles.empty}>No bills in the list yet.</p>
          ) : (
            <p className={styles.empty}>
              {monthLabel(startsOn)} isn&apos;t open yet: it opens on its own, with {bills.length} bill
              {bills.length === 1 ? "" : "s"} from the list.
            </p>
          )}
        </div>
      </section>
    </FinancesFrame>
  );
}

// A progress bar (DESIGN.md §6): the module colour on a neutral track.
function Bar({ percent, thick = false }: { percent: number; thick?: boolean }) {
  return (
    <span className={thick ? `${styles.track} ${styles.thick}` : styles.track} aria-hidden="true">
      <span className={styles.fill} style={{ width: `${percent}%` }} />
    </span>
  );
}
