import type { ReactNode } from "react";
import { LockIcon } from "../../../components/icons";
import { BILL_KINDS, dueLabel, listBills } from "../../../lib/finances/bills";
import {
  HOUSEHOLD_TIME_ZONE,
  householdToday,
  listPeople,
  listSplits,
  monthLabel,
  monthStart,
  splitInForce,
  splitIsHistory,
} from "../../../lib/finances/budget-year";
import {
  listOpenedMonths,
  monthClosed,
  monthShares,
  monthTotals,
  readMonth,
  type Month,
} from "../../../lib/finances/month";
import { annualIncome, budgetYearBefore, marchReview } from "../../../lib/finances/recalibrate";
import { CADENCES, listIncomeSources, payDates } from "../../../lib/finances/income";
import { formatMoney } from "../../../lib/finances/money";
import { Hint } from "../../../components/hint";
import { FinancesFrame, financesViewer } from "../frame";
import { removeBill, removeIncomeSource, removeSplit } from "./actions";
import { BillForm, IncomeForm, SplitForm } from "./forms";
import styles from "../../../components/cards.module.css";

const SECTION = "Budget year";

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: HOUSEHOLD_TIME_ZONE,
  });
}

// The twenty-four months from the budget year's April, for choosing when
// a split starts: this year and the next, and no browser date-picker
// quirks (Safari has no month picker).
// The months a new split may start in: this one and the next two years'
// worth. A month already gone isn't offered, because it can't be saved.
function monthOptions(today: string): { value: string; label: string }[] {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: 24 }, (_, step) => {
    const when = new Date(Date.UTC(year, month - 1 + step, 1));
    const value = when.toISOString().slice(0, 7);
    return { value, label: monthLabel(`${value}-01`) };
  });
}

// Every card on this page is the same shape: a tinted head with its name
// and a line of plain English, the form for adding on the module's quiet
// tint, then what's already saved as rounded boxes below (#132).
function Card({
  name,
  hint,
  addTitle,
  add,
  children,
}: {
  name: string;
  hint: string;
  addTitle: string;
  add: ReactNode;
  children: ReactNode;
}) {
  const id = addTitle.replaceAll(" ", "-").toLowerCase();
  return (
    <section className={styles.card} aria-labelledby={id}>
      <header className={styles.head}>
        <h2 id={id} className={styles.name}>
          {name}
        </h2>
        <Hint text={hint} />
      </header>
      <div className={styles.addBlock}>
        <h3 className={styles.addTitle}>{addTitle}</h3>
        {add}
      </div>
      <div className={styles.entries}>{children}</div>
    </section>
  );
}

// One saved thing: a rounded box with a name, a figure or chip, one line
// of detail, and the two ways to change it.
function Entry({
  name,
  aside,
  detail,
  changeLabel,
  change,
  remove,
}: {
  name: string;
  aside: ReactNode;
  detail: ReactNode;
  changeLabel?: string;
  change?: ReactNode;
  remove?: ReactNode;
}) {
  return (
    <li className={styles.entry}>
      <div className={styles.entryHead}>
        <span className={styles.entryName}>{name}</span>
        {aside}
      </div>
      {typeof detail === "string" ? <p className={styles.detail}>{detail}</p> : detail}
      {change || remove ? (
        <div className={styles.actions}>
          {change ? (
            <details className={styles.change}>
              <summary>{changeLabel}</summary>
              {change}
            </details>
          ) : null}
          {remove}
        </div>
      ) : null}
    </li>
  );
}

// The Budget year section (docs/design/DESIGN.md §7): the setup an admin
// keeps — the split (REQ-50), each person's income (REQ-51) and the bill
// list (REQ-94). Admin-only: members see it locked.
export default async function BudgetYearPage() {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();

  if (!canManageBudget) {
    return (
      <FinancesFrame canManageMembers={canManageMembers} canManageBudget={canManageBudget} account={account} section={SECTION} context="Settings">
        <div className={styles.cards}>
          <section className={styles.card} aria-labelledby="locked">
            <header className={styles.head}>
              <h2 id="locked" className={styles.name}>
                {SECTION}
              </h2>
              <p className={styles.note}>
                <LockIcon />
                Admin only. An admin sets the split, income sources and bills.
              </p>
            </header>
          </section>
        </div>
      </FinancesFrame>
    );
  }

  const todayIso = householdToday();
  const thisMonth = todayIso.slice(0, 7);
  const [people, splits, incomes, bills, opened] = await Promise.all([
    listPeople(supabase),
    listSplits(supabase),
    listIncomeSources(supabase),
    listBills(supabase),
    listOpenedMonths(supabase),
  ]);
  // The month now running, named, if it's been opened and hasn't closed:
  // bill changes then ask whether it takes them too.
  const running = monthStart(todayIso);
  const openMonth =
    opened.includes(running) && !(await monthClosed(supabase, running)) ? monthLabel(running) : undefined;
  const months = monthOptions(todayIso);
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const current = splitInForce(splits, todayIso);

  // REQ-69: in March, the review of April's split, with each person's
  // income over a year and what the household actually spent this
  // budget year, month by month as entered.
  const april = marchReview(todayIso, splits);
  const review = april
    ? await (async () => {
        const year = budgetYearBefore(april);
        const inYear = opened.filter((day) => day >= year.from && day < year.to);
        const months = (await Promise.all(inYear.map((day) => readMonth(supabase, day)))).filter(
          (month): month is Month => month !== null,
        );
        const spend =
          months.reduce(
            (sum, month) =>
              sum + Math.round(monthTotals(month, monthShares(month, splits, month.starts_on)).sharedBase * 100),
            0,
          ) / 100;
        return {
          april,
          income: annualIncome(
            incomes,
            people.map((person) => person.user_id),
          ),
          spend,
          months: months.length,
        };
      })()
    : null;

  return (
    <FinancesFrame canManageMembers={canManageMembers} canManageBudget={canManageBudget} account={account} section={SECTION} context="Settings">
      <div className={styles.cards}>
        {review ? (
          <section className={styles.card} aria-labelledby="march-review">
            <header className={styles.head}>
              <h2 id="march-review" className={styles.name}>
                Split for {monthLabel(review.april)}
              </h2>
              <Hint text="It's March: set the split for the budget year starting in April. Months already closed keep the split they had." />
            </header>
            <div className={styles.entries}>
              <ul className={styles.list}>
                {review.income.map((person) => (
                  <li key={person.user_id} className={styles.entry}>
                    <div className={styles.entryHead}>
                      <span className={styles.entryName}>{nameOf.get(person.user_id) ?? "Someone"}</span>
                      <span className={styles.amount}>{formatMoney(person.annual)} a year</span>
                    </div>
                    {person.percentOfBoth === null ? null : (
                      <p className={styles.detail}>{person.percentOfBoth}% of both incomes</p>
                    )}
                  </li>
                ))}
                <li className={styles.entry}>
                  <div className={styles.entryHead}>
                    <span className={styles.entryName}>Household spend</span>
                    <span className={styles.amount}>{formatMoney(review.spend)}</span>
                  </div>
                  <p className={styles.detail}>
                    This budget year, over {review.months} {review.months === 1 ? "month" : "months"}
                  </p>
                </li>
              </ul>
            </div>
            <div className={styles.addBlock}>
              <h3 className={styles.addTitle}>New split from {monthLabel(review.april)}</h3>
              <SplitForm
                people={people}
                months={months}
                month={review.april.slice(0, 7)}
                percents={
                  current ? Object.fromEntries(current.shares.map((share) => [share.user_id, share.percent])) : undefined
                }
              />
            </div>
          </section>
        ) : null}
        <Card
          name="Income sources"
          hint="What lands, and when. Editing one changes it from today; past paydays keep their amount."
          addTitle="Add an income source"
          add={<IncomeForm people={people} />}
        >
          {incomes.length === 0 ? (
            <p className={styles.empty}>Nothing saved yet. Add one for every regular paycheck.</p>
          ) : (
            <ul className={styles.list}>
              {incomes.map((income) => (
                <Entry
                  key={income.id}
                  name={income.name || nameOf.get(income.owner_id) || "Income"}
                  aside={<span className={styles.amount}>{formatMoney(income.net_amount)}</span>}
                  detail={[
                    income.name ? nameOf.get(income.owner_id) ?? "Someone" : null,
                    CADENCES[income.cadence],
                    `next ${shortDate(payDates(income, todayIso, 1)[0])}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  changeLabel="Edit"
                  change={<IncomeForm people={people} source={income} />}
                  remove={
                    <form action={removeIncomeSource}>
                      <input type="hidden" name="id" value={income.id} />
                      <button
                        type="submit"
                        className={styles.quiet}
                        aria-label={`Remove ${income.name || "income source"}`}
                      >
                        Remove
                      </button>
                    </form>
                  }
                />
              ))}
            </ul>
          )}
        </Card>

        <Card
          name="Bills"
          hint="The bills you split every month. A change applies from the next month opened, and to this month too if you tick it."
          addTitle="Add a bill"
          add={<BillForm openMonth={openMonth} />}
        >
          {bills.length === 0 ? (
            <p className={styles.empty}>Nothing saved yet. Add rent and each card you split.</p>
          ) : (
            <ul className={styles.list}>
              {bills.map((bill) => (
                <Entry
                  key={bill.id}
                  name={bill.name}
                  aside={<span className={styles.status}>{BILL_KINDS[bill.kind]}</span>}
                  detail={
                    bill.kind === "rent" && bill.amount !== null
                      ? `${formatMoney(bill.amount)} · ${dueLabel(bill.due_day)} of each month`
                      : bill.kind === "rent"
                        ? `${dueLabel(bill.due_day)} of each month · add the amount`
                        : `${dueLabel(bill.due_day)} of each month`
                  }
                  changeLabel="Edit"
                  change={<BillForm bill={bill} openMonth={openMonth} />}
                  remove={
                    <form action={removeBill} className={styles.removeBill}>
                      <input type="hidden" name="id" value={bill.id} />
                      {openMonth ? (
                        <label className={styles.check}>
                          <input
                            type="checkbox"
                            name="applyToMonth"
                            defaultChecked
                            aria-label={`Also set ${bill.name} to $0 in ${openMonth} if not entered yet`}
                          />
                          Also in {openMonth}: $0 if not entered yet
                        </label>
                      ) : null}
                      <button type="submit" className={styles.quiet} aria-label={`Remove ${bill.name}`}>
                        Remove
                      </button>
                    </form>
                  }
                />
              ))}
            </ul>
          )}
        </Card>
        <Card
          name="Split"
          hint="How you divide shared costs. It applies from the month you pick onwards."
          addTitle="Add a split"
          add={<SplitForm people={people} months={months} month={thisMonth} />}
        >
          {splits.length === 0 ? (
            <p className={styles.empty}>Nothing saved yet. A split says how you divide shared costs.</p>
          ) : (
            <ul className={styles.list}>
              {splits.map((split) => {
                // A split that has started belongs to the months it ran:
                // to change how you divide costs now, add a new one.
                const history = splitIsHistory(split, todayIso);
                return (
                  <Entry
                    key={split.id}
                    name={`From ${monthLabel(split.effective_from)}`}
                    aside={
                      split.id === current?.id ? <span className={styles.status}>In force</span> : null
                    }
                    detail={
                      <ul className={styles.shares}>
                        {split.shares.map((share) => (
                          <li key={share.user_id} className={styles.entryHead}>
                            <span className={styles.person}>
                              {nameOf.get(share.user_id) ?? "Someone"}
                            </span>
                            <span className={styles.amount}>{share.percent}%</span>
                          </li>
                        ))}
                      </ul>
                    }
                    changeLabel="Edit"
                    change={
                      history ? undefined : (
                      <SplitForm
                        people={people}
                        months={months}
                        month={split.effective_from.slice(0, 7)}
                        percents={Object.fromEntries(
                          split.shares.map((share) => [share.user_id, share.percent]),
                        )}
                        note={split.note}
                        editing
                      />
                      )
                    }
                    remove={
                      history ? undefined : (
                      <form action={removeSplit}>
                        <input type="hidden" name="id" value={split.id} />
                        <button
                          type="submit"
                          className={styles.quiet}
                          aria-label={`Remove the split from ${monthLabel(split.effective_from)}`}
                        >
                          Remove
                        </button>
                      </form>
                      )
                    }
                  />
                );
              })}
            </ul>
          )}
        </Card>

      </div>
    </FinancesFrame>
  );
}
