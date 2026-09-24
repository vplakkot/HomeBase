import type { SupabaseClient } from "@supabase/supabase-js";

// Account balances, entered once a month (REQ-67), how they move (REQ-68),
// and the cash set beside the month's leftover (REQ-65).

export type Account = "401k" | "espp" | "rsu" | "investments" | "cash";

export const ACCOUNTS: Record<Account, string> = {
  "401k": "401k",
  espp: "ESPP",
  rsu: "RSU",
  investments: "Investments",
  cash: "Cash",
};

export const ACCOUNT_ORDER = Object.keys(ACCOUNTS) as Account[];

export function isAccount(value: string): value is Account {
  return Object.hasOwn(ACCOUNTS, value);
}

export type Balance = { month: string; user_id: string; account: Account; amount: number };

// Every balance ever entered, oldest month first.
export async function listBalances(supabase: SupabaseClient): Promise<Balance[]> {
  const { data, error } = await supabase
    .from("balances")
    .select("month, user_id, account, amount")
    .order("month", { ascending: true });
  if (error) throw new Error(`Could not read the balances: ${error.message}`);
  return ((data ?? []) as Balance[]).map((row) => ({ ...row, amount: Number(row.amount) }));
}

// What a box starts with (REQ-67): this month's figure if entered,
// otherwise the most recent earlier one as a starting point.
export function startingPoint(
  balances: Balance[],
  month: string,
  userId: string,
  account: Account,
): { amount: number; carried: boolean } | null {
  const earlier = balances.filter(
    (row) => row.user_id === userId && row.account === account && row.month <= month,
  );
  const latest = earlier.at(-1);
  if (!latest) return null;
  return { amount: latest.amount, carried: latest.month !== month };
}

export type TrendAccount = {
  user_id: string;
  account: Account;
  // Null when this account wasn't entered that month.
  amount: number | null;
  // Against the month before; null when either month lacks it.
  change: number | null;
};

export type TrendMonth = {
  month: string;
  total: number;
  // Against the month before, over the accounts entered in both, so a
  // skipped box doesn't read as money lost; null for the first month.
  change: number | null;
  // True when an account is in only one of the two months, so the change
  // leaves it out and says it's "on the same accounts" (Vin, 2026-09-24).
  partial: boolean;
  // Accounts that had a balance some month but not this one.
  missing: number;
  accounts: TrendAccount[];
};

const cents = (amount: number) => Math.round(amount * 100);

// REQ-68: each month with balances, newest first — the combined total and
// its change, and every account's figure and change. An account counts
// once anyone has entered it for that person; a month without it shows
// the gap instead of treating it as $0.
export function balanceTrend(balances: Balance[]): TrendMonth[] {
  const months = [...new Set(balances.map((row) => row.month))].sort();
  const seen = new Map<string, { user_id: string; account: Account }>();
  for (const row of balances) seen.set(`${row.user_id}/${row.account}`, row);
  const tracked = [...seen.values()].sort(
    (a, b) => a.user_id.localeCompare(b.user_id) || ACCOUNT_ORDER.indexOf(a.account) - ACCOUNT_ORDER.indexOf(b.account),
  );
  const amountAt = (month: string | undefined, userId: string, account: Account) =>
    month === undefined
      ? null
      : (balances.find((row) => row.month === month && row.user_id === userId && row.account === account)?.amount ??
        null);

  const trend = months.map((month, index) => {
    const before = months[index - 1];
    const accounts = tracked.map(({ user_id, account }) => {
      const amount = amountAt(month, user_id, account);
      const previous = amountAt(before, user_id, account);
      return {
        user_id,
        account,
        amount,
        change: amount === null || previous === null ? null : (cents(amount) - cents(previous)) / 100,
      };
    });
    const total =
      balances.filter((row) => row.month === month).reduce((sum, row) => sum + cents(row.amount), 0) / 100;
    const change =
      before === undefined
        ? null
        : accounts.reduce((sum, entry) => sum + (entry.change === null ? 0 : cents(entry.change)), 0) / 100;
    const partial = before !== undefined && accounts.some((entry) => entry.change === null);
    return { month, total, change, partial, missing: accounts.filter((a) => a.amount === null).length, accounts };
  });
  return trend.reverse();
}

// REQ-65, decided 2026-09-24: cash more than this above the leftover is
// worth flagging. A starting figure, to revisit after some real months.
export const CASH_GAP_FLAG = 500;

export type CashCheck =
  | { checked: false }
  | { checked: true; cash: number; leftover: number; gap: number; flagged: boolean };

// REQ-65: a person's cash beside what the month says they have left. No
// cash entered, or no leftover to compare with, skips the check.
export function cashCheck(cash: number | null, leftover: number | null): CashCheck {
  if (cash === null || leftover === null) return { checked: false };
  const gap = (cents(cash) - cents(leftover)) / 100;
  return { checked: true, cash, leftover, gap, flagged: gap > CASH_GAP_FLAG };
}
