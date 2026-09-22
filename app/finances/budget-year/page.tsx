import { LockIcon } from "../../../components/icons";
import { BILL_KINDS, dueLabel, listBills } from "../../../lib/finances/bills";
import {
  budgetYearLabel,
  budgetYearStartFor,
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
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// The Budget year section (docs/design/DESIGN.md §7): the yearly setup an
// admin does — the split (REQ-50), each person's income sources (REQ-51)
// and the bill list (REQ-94). Admin-only: members see it locked.
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
            {budgetYear
              ? `${budgetYearLabel(startYear)} is set. Every month in it uses this split.`
              : `No split yet for ${budgetYearLabel(startYear)}.`}
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
          {incomes.length === 0 ? (
            <p className={`${shared.cardNote} ${styles.pad}`}>No income sources yet.</p>
          ) : (
            <ul className={shared.rows}>
              {incomes.map((income) => (
                <li key={income.id} className={shared.billRow}>
                  <span className={shared.billText}>
                    <span className={shared.billName}>
                      {nameOf.get(income.owner_id) ?? "Someone"} · {formatMoney(income.net_amount)}
                    </span>
                    <span className={shared.cardNote}>
                      {CADENCES[income.cadence]} · next paydays{" "}
                      {payDates(income, todayIso, 3).map(shortDate).join(", ")}
                    </span>
                  </span>
                  <form action={removeIncomeSource}>
                    <input type="hidden" name="id" value={income.id} />
                    <button type="submit" className={shared.button}>
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <IncomeForm people={people} />
        </section>

        <section className={shared.card} aria-labelledby="bill-list">
          <h2 id="bill-list" className={shared.cardTitle}>
            Bills
          </h2>
          <p className={`${shared.cardNote} ${styles.pad}`}>
            Changes apply from the next month opened; months already open keep theirs.
          </p>
          {bills.length === 0 ? null : (
            <ul className={shared.rows}>
              {bills.map((bill) => (
                <li key={bill.id} className={styles.billItem}>
                  <span className={shared.cardNote}>
                    {BILL_KINDS[bill.kind]} · {dueLabel(bill.due_day)}
                  </span>
                  <BillForm bill={bill} />
                  <form action={removeBill}>
                    <input type="hidden" name="id" value={bill.id} />
                    <button type="submit" className={shared.button} aria-label={`Remove ${bill.name}`}>
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <BillForm />
        </section>
      </div>
    </FinancesFrame>
  );
}
