import type { Split } from "./budget-year";
import type { Cadence, IncomeSource } from "./income";

// REQ-69: each March the admin reviews the split for the budget year that
// starts in April, once raises and bonuses have landed.

// The April to review for, as "YYYY-04-01", while it's March and no split
// starting that April has been saved yet; otherwise null.
export function marchReview(today: string, splits: Split[]): string | null {
  const [year, month] = today.split("-").map(Number);
  if (month !== 3) return null;
  const april = `${year}-04-01`;
  return splits.some((split) => split.effective_from === april) ? null : april;
}

// The budget year a March review looks back on: the April before it up to
// (not including) the April it's for.
export function budgetYearBefore(april: string): { from: string; to: string } {
  return { from: `${Number(april.slice(0, 4)) - 1}-04-01`, to: april };
}

const PAYS_PER_YEAR: Record<Cadence, number> = { weekly: 52, biweekly: 26, monthly: 12 };

// Each person's pay over a year, from their income sources as they stand:
// net per payment × payments a year. Cents, so it adds up exactly.
export function annualIncome(sources: IncomeSource[], people: string[]) {
  const each = people.map((user_id) => ({
    user_id,
    annual:
      sources
        .filter((source) => source.owner_id === user_id && !source.ended_on)
        .reduce((sum, source) => sum + Math.round(source.net_amount * 100) * PAYS_PER_YEAR[source.cadence], 0) / 100,
  }));
  const both = each.reduce((sum, person) => sum + Math.round(person.annual * 100), 0);
  return each.map((person) => ({
    ...person,
    // Each person's share of the two incomes together, a starting point
    // for the split (REQ-69 doesn't recommend one).
    percentOfBoth: both === 0 ? null : Math.round((Math.round(person.annual * 100) * 10000) / both) / 100,
  }));
}
