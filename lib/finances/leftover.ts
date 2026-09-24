import { payDates, type IncomeSource } from "./income";
import type { IncomeKind, MonthIncome, MonthTotals } from "./month";

// Money that landed in a month (REQ-60). Shares kept rather than sold
// aren't income, so only sales are offered.
export const INCOME_KINDS: Record<IncomeKind, string> = {
  paycheck: "Paycheck",
  espp: "ESPP sale",
  rsu: "RSU sale",
  bonus: "Bonus",
  other: "Other",
};

export function isIncomeKind(value: string): value is IncomeKind {
  return Object.hasOwn(INCOME_KINDS, value);
}

export type ExpectedPaycheck = {
  source_id: string;
  owner_id: string;
  name: string;
  amount: number;
  payday: string;
};

// The paychecks the income setup expects in a month, up to today, that
// nobody has confirmed yet: each source's paydays inside the month, on
// the days that source was in force (effective_from <= day < ended_on).
export function expectedPaychecks(
  sources: (IncomeSource & { effective_from: string })[],
  startsOn: string,
  today: string,
  logged: MonthIncome[],
): ExpectedPaycheck[] {
  const [year, month] = startsOn.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const confirmed = new Set(logged.map((row) => `${row.income_source_id}/${row.received_on}`));
  return sources
    .flatMap((source) =>
      payDates(source, startsOn, 6)
        .filter(
          (day) =>
            day < nextMonth &&
            day <= today &&
            source.effective_from <= day &&
            (!source.ended_on || day < source.ended_on) &&
            !confirmed.has(`${source.id}/${day}`),
        )
        .map((day) => ({
          source_id: source.id,
          owner_id: source.owner_id,
          name: source.name,
          amount: source.net_amount,
          payday: day,
        })),
    )
    .sort((a, b) => a.payday.localeCompare(b.payday) || a.name.localeCompare(b.name));
}

// Vin, 2026-09-24: while a month is running, a paycheck the income setup
// expects counts as income until someone confirms it, so the savings card
// shows what's likely rather than "take from savings" on the 2nd of the
// month. Every payday in the month counts, not only those gone by.
export function projectedIncome(
  sources: (IncomeSource & { effective_from: string })[],
  startsOn: string,
  logged: MonthIncome[],
): { income: MonthIncome[]; projected: boolean } {
  const [year, month] = startsOn.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const expected = expectedPaychecks(sources, startsOn, monthEnd, logged).map((paycheck) => ({
    id: `expected:${paycheck.source_id}/${paycheck.payday}`,
    owner_id: paycheck.owner_id,
    kind: "paycheck" as const,
    amount: paycheck.amount,
    received_on: paycheck.payday,
    income_source_id: paycheck.source_id,
    note: paycheck.name,
  }));
  return { income: [...logged, ...expected], projected: expected.length > 0 };
}

export type Leftover = { user_id: string; income: number; obligation: number; leftover: number };

// REQ-61: what each person has left after their share of the household
// (income received − obligation), and the two together. Cents, so it
// adds up exactly.
export function leftovers(totals: MonthTotals, income: MonthIncome[]) {
  const people: Leftover[] = totals.people.map((person) => {
    const received = income
      .filter((row) => row.owner_id === person.user_id)
      .reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
    const owed = Math.round(person.obligation * 100);
    return {
      user_id: person.user_id,
      income: received / 100,
      obligation: person.obligation,
      leftover: (received - owed) / 100,
    };
  });
  const joint = people.reduce((sum, person) => sum + Math.round(person.leftover * 100), 0) / 100;
  return { people, joint };
}
