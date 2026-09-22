import { LockIcon } from "../../../components/icons";
import { BILL_KINDS, dueLabel, listBills } from "../../../lib/finances/bills";
import {
  budgetYearLabel,
  budgetYearStartFor,
  HOUSEHOLD_TIME_ZONE,
  householdToday,
  listPeople,
  readBudgetYear,
} from "../../../lib/finances/budget-year";
import { CADENCES, listIncomeSources, payDates } from "../../../lib/finances/income";
import { formatMoney } from "../../../lib/finances/money";
import { FinancesFrame, financesViewer } from "../frame";
import shared from "../page.module.css";
import { removeBill, removeIncomeSource } from "./actions";
import { BillForm, IncomeForm, SplitForm } from "./forms";
import styles from "./page.module.css";

const SECTION = "Budget year";

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: HOUSEHOLD_TIME_ZONE,
  });
}

// The Budget year section (docs/design/DESIGN.md §7): the yearly setup an
// admin does — the split (REQ-50), each person's income sources (REQ-51)
// and the bill list (REQ-94). Admin-only: members see it locked.
//
// Each card puts what you add at the top and what's already there below,
// so adding something never moves the form you're typing in (#128).
export default async function BudgetYearPage() {
  const { supabase, canManageMembers, canManageBudget, account } = await financesViewer();

  if (!canManageBudget) {
    return (
      <FinancesFrame canManageMembers={canManageMembers} account={account} section={SECTION}>
        <section className={shared.card} aria-labelledby="locked">
          <h2 id="locked" className={shared.cardTitle}>
            {SECTION}
          </h2>
          <p className={`${shared.cardNote} ${styles.lockedNote}`}>
            <LockIcon />
            Admin only. An admin sets the split, income sources and bills.
          </p>
        </section>
      </FinancesFrame>
    );
  }

  const todayIso = householdToday();
  const startYear = budgetYearStartFor(todayIso);
  const [people, budgetYear, incomes, bills] = await Promise.all([
    listPeople(supabase),
    readBudgetYear(supabase, startYear),
    listIncomeSources(supabase),
    listBills(supabase),
  ]);
  const nameOf = new Map(people.map((person) => [person.user_id, person.name]));
  const percents = Object.fromEntries(
    (budgetYear?.shares ?? []).map((share) => [share.user_id, share.percent]),
  );

  return (
    <FinancesFrame canManageMembers={canManageMembers} account={account} section={SECTION}>
      <div className={styles.cards}>
        <section className={shared.card} aria-labelledby="split">
          <h2 id="split" className={shared.cardTitle}>
            Split
          </h2>
          <p className={`${shared.cardNote} ${styles.pad}`}>
            Your budget year runs {budgetYearLabel(startYear).replace(" – ", " to ")}. Every month
            in it uses this split.
          </p>
          <SplitForm
            people={people}
            startYear={startYear}
            percents={percents}
            note={budgetYear?.note ?? ""}
          />
        </section>

        <section className={shared.card} aria-labelledby="income">
          <h2 id="income" className={shared.cardTitle}>
            Income sources
          </h2>
          <div className={styles.addBlock}>
            <h3 className={styles.addTitle}>Add an income source</h3>
            <IncomeForm people={people} />
          </div>
          {incomes.length === 0 ? (
            <p className={`${shared.cardNote} ${styles.pad} ${styles.padTop}`}>
              Nothing added yet. Add one for every regular paycheck.
            </p>
          ) : (
            <ul className={shared.rows}>
              {incomes.map((income) => (
                <li key={income.id} className={styles.entry}>
                  <div className={styles.entryHead}>
                    <span className={styles.entryName}>
                      {income.name || nameOf.get(income.owner_id) || "Income"}
                    </span>
                    <span className={styles.amount}>{formatMoney(income.net_amount)}</span>
                  </div>
                  <p className={shared.cardNote}>
                    {nameOf.get(income.owner_id) ?? "Someone"} · {CADENCES[income.cadence]}
                  </p>
                  <p className={shared.cardNote}>
                    Next paydays {payDates(income, todayIso, 3).map(shortDate).join(", ")}
                  </p>
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
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={shared.card} aria-labelledby="bill-list">
          <h2 id="bill-list" className={shared.cardTitle}>
            Bills
          </h2>
          <div className={styles.addBlock}>
            <h3 className={styles.addTitle}>Add a bill</h3>
            <BillForm />
          </div>
          {bills.length === 0 ? (
            <p className={`${shared.cardNote} ${styles.pad} ${styles.padTop}`}>
              No bills yet. Add rent and each card you split.
            </p>
          ) : (
            <ul className={shared.rows}>
              {bills.map((bill) => (
                <li key={bill.id} className={styles.entry}>
                  <div className={styles.entryHead}>
                    <span className={styles.entryName}>{bill.name}</span>
                    <span className={styles.kind}>{BILL_KINDS[bill.kind]}</span>
                  </div>
                  <p className={shared.cardNote}>{dueLabel(bill.due_day)} of each month</p>
                  <details className={styles.change}>
                    <summary>Change</summary>
                    <BillForm bill={bill} />
                    <form action={removeBill}>
                      <input type="hidden" name="id" value={bill.id} />
                      <button type="submit" className={styles.quiet} aria-label={`Remove ${bill.name}`}>
                        Remove
                      </button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <p className={`${shared.cardNote} ${styles.pad} ${styles.padTop}`}>
            Changes apply from the next month opened; months already open keep theirs.
          </p>
        </section>
      </div>
    </FinancesFrame>
  );
}
