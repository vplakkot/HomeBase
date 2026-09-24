import Link from "next/link";
import { ChevronRightIcon, LockIcon } from "../../components/icons";
import { SectionLabel } from "../../components/section-label";
import {
  householdToday,
  listPeople,
  listSplits,
  monthLabel,
  splitInForce,
} from "../../lib/finances/budget-year";
import { dueLabel, listBills } from "../../lib/finances/bills";
import { leftovers } from "../../lib/finances/leftover";
import {
  billEntered,
  chosenMonth,
  dayLabel,
  dueInMonth,
  listOpenedMonths,
  monthShares,
  monthStatus,
  monthTotals,
  pickableMonths,
  readMonth,
} from "../../lib/finances/month";
import { formatMoney } from "../../lib/finances/money";
import { nothingToSaveReasons, savingsPlan } from "../../lib/finances/savings";
import { closeMonthWithBalance } from "./actions";
import { marchReview } from "../../lib/finances/recalibrate";
import { acknowledge } from "../../lib/finances/snapshot";
import { FinancesFrame, financesViewer } from "./frame";
import { Hint } from "./hint";
import styles from "./page.module.css";

// The Finances module's home: the current month (docs/design/DESIGN.md §7).
// Until a budget year covers this month, the whole page is one card asking
// for setup: an admin gets Start setup, a member is told who to ask. Once
// it exists, the month in focus (REQ-92) shows who owes what — one card
// per person with their obligation, paid and outstanding (REQ-56, 58) —
// and the month's bills as rows (REQ-53, REQ-94): the month's own copy
// once it's opened, with paid of total and what's left, or the
// household's list before that. A month with a bill still to enter reads
// Incomplete; one squared closes on its own that night, and an admin can
// close one with a balance left (REQ-59). A closed month is shown as it
// closed, with the percentages written on it (REQ-52). The verdict card
// says whether the month moved you forward (REQ-61), with what goes into
// joint savings (REQ-63) or, in words, why nothing does (REQ-64). Opening
// a month someone else entered clears its "numbers are ready" item (REQ-93).
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
  // REQ-69: in March the admin is prompted to review April's split.
  const reviewFor = marchReview(todayIso, splits);
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
  // The month shown runs on the split that had started by then, or the
  // percentages written on it when it closed.
  const shares = monthShares(month, splits, startsOn);
  const totals = month ? monthTotals(month, shares) : null;
  const status = monthStatus(month, shares, todayIso);
  const verdict = month && totals && totals.people.length > 0 ? leftovers(totals, month.income) : null;
  // What goes into joint savings (REQ-63), or why nothing does (REQ-64).
  const plan = verdict ? savingsPlan(verdict.people) : null;
  const ended = Boolean(month?.closed_at) || status === "Ended · not squared";
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
          share: money && billEntered(bill) && money.total > 0 ? Math.min(money.paid / money.total, 1) : null,
        };
      })
    : bills.map((bill) => ({
        id: bill.id,
        name: bill.name,
        note: dueLabel(bill.due_day),
        chip: { text: "Not entered", done: false },
        left: null,
        share: null,
      }));
  const toEnter = month ? month.bills.filter((bill) => !billEntered(bill)).length : 0;
  const billsLeft = totals ? totals.bills.reduce((sum, row) => sum + Math.max(row.left, 0), 0) : 0;
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const percentages = (list: { user_id: string; percent: number }[]) =>
    list.map((share) => `${nameOf.get(share.user_id) ?? "Someone"} ${share.percent}%`).join(" · ");
  const sharesLine = percentages(split.shares);
  // What was still owed when the month closed, and by whom (REQ-59).
  const leftOwing = month?.closed_at ? month.people.filter((person) => person.outstanding > 0) : [];
  const allEntered = month ? month.bills.every(billEntered) : false;
  // REQ-93: "numbers are ready" clears once the person who didn't enter
  // them has opened the month. Losing this only leaves the note up.
  if (month && allEntered && month.bills.some((bill) => bill.entered_by && bill.entered_by !== userId)) {
    await acknowledge(supabase, `ready:${startsOn}`).catch((reason) => console.error(reason));
  }

  return (
    <FinancesFrame
      canManageMembers={canManageMembers}
      account={account}
      status={status}
      month={picker}
    >
      <Link href={`/finances/monthly-entry?month=${startsOn.slice(0, 7)}`} className={styles.entryRow}>
        <span className={styles.rowText}>
          <span className={styles.billName}>{month ? "Monthly entry" : `Open ${monthLabel(startsOn)}`}</span>
          <span className={styles.cardNote}>
            {!month
              ? "Copies in the bill list, ready to enter"
              : toEnter > 0
                ? `${toEnter} bill${toEnter === 1 ? "" : "s"} still to enter`
                : "Bills, personal charges and One-time Payments"}
          </span>
        </span>
        <ChevronRightIcon />
      </Link>

      {month?.closed_at ? (
        <section className={styles.card} aria-label="Closed month">
          <p className={styles.cardNote}>
            Closed {dayLabel(month.closed_at.slice(0, 10))}
            {month.closed_automatically ? ", squared" : ""} · split from{" "}
            {month.split_from ? monthLabel(month.split_from) : "no split"}: {percentages(month.people)}
          </p>
          {leftOwing.map((person) => {
            const name = nameOf.get(person.user_id) ?? "Someone";
            return (
              <p key={person.user_id} className={styles.cardNote}>
                Closed with {formatMoney(person.outstanding)} of {name}&apos;s unpaid. When it shows up on next
                month&apos;s statement, declare it as {name}&apos;s personal charge so it isn&apos;t split again.
              </p>
            );
          })}
        </section>
      ) : null}

      <div className={styles.columns}>
        {verdict ? (
          <section className={styles.group} aria-labelledby="verdict">
            <div className={styles.groupHead}>
              <SectionLabel id="verdict">This month</SectionLabel>
              <Hint text="Leftover excludes personal card spend: it's income logged minus your share of the household." />
            </div>
            {month && month.income.length === 0 ? (
              <Link href={`/finances/income?month=${startsOn.slice(0, 7)}`} className={styles.entryRow}>
                <span className={styles.rowText}>
                  <span className={styles.billName}>No income logged yet</span>
                  <span className={styles.cardNote}>Confirm paychecks to see what&apos;s left</span>
                </span>
                <ChevronRightIcon />
              </Link>
            ) : (
              <div className={plan && plan.joint > 0 ? styles.verdict : styles.verdictQuiet}>
                <span className={styles.verdictTitle}>
                  {plan && plan.joint > 0
                    ? ended
                      ? "Moved you forward"
                      : "On track to move you forward"
                    : "Nothing to save this month"}
                </span>
                {plan && plan.joint > 0 ? (
                  <>
                    <span className={styles.figure}>{formatMoney(plan.joint)}</span>
                    <span className={styles.verdictLabel}>Joint savings{ended ? "" : ", projected"}</span>
                    {plan.people.map((person) => (
                      <span key={person.user_id} className={styles.cardNote}>
                        {nameOf.get(person.user_id) ?? "Someone"}: {formatMoney(person.toJoint)} to joint ·{" "}
                        {formatMoney(person.yours)} yours
                      </span>
                    ))}
                  </>
                ) : (
                  <>
                    {plan
                      ? nothingToSaveReasons(plan, (id) => nameOf.get(id) ?? "Someone").map((reason) => (
                          <span key={reason} className={styles.cardNote}>
                            {reason}
                          </span>
                        ))
                      : null}
                    <span className={styles.cardNote}>
                      {verdict.people
                        .map(
                          (person) =>
                            `${nameOf.get(person.user_id) ?? "Someone"} ${person.leftover < 0 ? "−" : ""}${formatMoney(Math.abs(person.leftover))}`,
                        )
                        .join(" · ")}{" "}
                      left
                    </span>
                  </>
                )}
              </div>
            )}
          </section>
        ) : null}

        {totals && totals.people.length > 0 ? (
          <section className={styles.group} aria-labelledby="who-owes">
            <SectionLabel id="who-owes">Who owes what</SectionLabel>
            <ul className={styles.people}>
              {totals.people.map((person) => {
                const name = nameOf.get(person.user_id) ?? "Someone";
                const settled = person.outstanding <= 0;
                const done = person.obligation > 0 ? Math.min(person.paid / person.obligation, 1) : 1;
                return (
                  <li key={person.user_id} className={styles.person}>
                    <span className={styles.personName}>{name}</span>
                    {settled ? (
                      <span className={`${styles.figure} ${styles.paidUp}`}>Paid up</span>
                    ) : (
                      <span className={styles.figure}>{formatMoney(person.outstanding)}</span>
                    )}
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
                      <span
                        className={settled ? `${styles.progressFill} ${styles.done}` : styles.progressFill}
                        style={{ width: `${done * 100}%` }}
                      />
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
                    {person.fronted > 0 ? ` (${formatMoney(person.fronted)} of it in One-time Payments)` : ""}
                    .
                  </p>
                );
              })}
              <p className={styles.cardNote}>
                Together that&apos;s {formatMoney(totals.expenses + totals.direct)}: the bills plus the
                One-time Payments.
              </p>
            </details>
          </section>
        ) : null}

        <section className={styles.group} aria-labelledby="bills">
          <div className={styles.groupHead}>
            <SectionLabel id="bills">Bills</SectionLabel>
            {totals ? (
              <span className={styles.groupNote}>
                {formatMoney(billsLeft)} of {formatMoney(totals.expenses)} left
              </span>
            ) : null}
          </div>
          <div className={styles.card}>
            {rows.length === 0 ? (
              <p className={styles.cardNote}>No bills in the list yet.</p>
            ) : (
              <ul className={styles.rows}>
                {rows.map((row) => (
                  <li key={row.id} className={styles.billRow}>
                    <span className={styles.billLine}>
                      <span className={styles.billText}>
                        <span className={styles.billName}>{row.name}</span>
                        <span className={styles.cardNote}>{row.note}</span>
                      </span>
                      {row.chip ? (
                        <span className={row.chip.done ? styles.paidChip : styles.status}>{row.chip.text}</span>
                      ) : row.left !== null ? (
                        <span className={styles.owed}>{formatMoney(row.left)} left</span>
                      ) : null}
                    </span>
                    {row.share !== null ? (
                      <span className={styles.thinTrack} aria-hidden="true">
                        <span
                          className={row.share >= 1 ? `${styles.progressFill} ${styles.done}` : styles.progressFill}
                          style={{ width: `${row.share * 100}%` }}
                        />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className={styles.group} aria-labelledby="admin">
        <SectionLabel id="admin">Admin</SectionLabel>
        <div className={styles.card}>
          {month && !month.closed_at ? (
            canManageBudget ? (
              <details className={styles.closeRow}>
                <summary className={styles.entryRowInner}>
                  <span className={styles.rowText}>
                    <span className={styles.billName}>Close month with balance</span>
                    <span className={styles.cardNote}>
                      {status === "Squared"
                        ? "Squared: it closes on its own tonight"
                        : allEntered
                          ? "Only if what's owed won't be paid"
                          : "Enter every bill first"}
                    </span>
                  </span>
                  <ChevronRightIcon />
                </summary>
                {allEntered && status !== "Squared" ? (
                  <form action={closeMonthWithBalance} className={styles.closeForm}>
                    <input type="hidden" name="monthId" value={month.id} />
                    <p className={styles.cardNote}>
                      {(totals?.people ?? [])
                        .filter((person) => person.outstanding > 0)
                        .map((person) => `${nameOf.get(person.user_id) ?? "Someone"} still owes ${formatMoney(person.outstanding)}`)
                        .join(" · ") || "Nobody owes anything, but a bill isn't paid in full"}
                      . Closing records that and locks {monthLabel(startsOn)}; nothing carries into next month.
                    </p>
                    <button type="submit" className={styles.firstRunButton}>
                      Close {monthLabel(startsOn)}
                    </button>
                  </form>
                ) : null}
              </details>
            ) : (
              <div className={styles.entryRowInner}>
                <span className={styles.rowText}>
                  <span className={styles.billName}>Close month with balance</span>
                </span>
                <span className={styles.locked}>
                  <LockIcon />
                  Admin only
                </span>
              </div>
            )
          ) : null}
          {canManageBudget ? (
            <Link href="/finances/budget-year" className={styles.entryRowInner}>
              <span className={styles.rowText}>
                <span className={styles.billName}>Budget year</span>
                <span className={styles.cardNote}>
                  {reviewFor
                    ? `Review the split for ${monthLabel(reviewFor)}`
                    : `From ${monthLabel(split.effective_from)} · ${sharesLine}`}
                </span>
              </span>
              <ChevronRightIcon />
            </Link>
          ) : (
            <div className={styles.entryRowInner}>
              <span className={styles.rowText}>
                <span className={styles.billName}>Budget year</span>
                <span className={styles.cardNote}>
                  From {monthLabel(split.effective_from)} · {sharesLine}
                </span>
              </span>
              <span className={styles.locked}>
                <LockIcon />
                Admin only
              </span>
            </div>
          )}
        </div>
      </section>
    </FinancesFrame>
  );
}
