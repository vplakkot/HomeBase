import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillKind } from "./bills";
import { monthStart, type Share } from "./budget-year";

// A month of household spending (REQ-53, 54, 55). Opening it copies the
// bill list in; members then enter each bill's amount, declare personal
// charges inside card statements, and log shared spend one of them paid.

export type PersonalCharge = { id: string; owner_id: string; amount: number; note: string };
export type DirectPayment = { id: string; payer_id: string; amount: number; note: string };
export type MonthBill = {
  id: string;
  name: string;
  kind: BillKind;
  due_day: number;
  amount: number | null;
  personal_answer: "none" | "some" | null;
  personal_charges: PersonalCharge[];
};
export type Month = {
  id: string;
  starts_on: string;
  bills: MonthBill[];
  direct_payments: DirectPayment[];
};

const MONTH_FIELDS = `id, starts_on,
  bills:month_bills(id, name, kind, due_day, amount, personal_answer,
    personal_charges(id, owner_id, amount, note)),
  direct_payments(id, payer_id, amount, note)`;

// Postgres hands numeric columns back as strings.
const money = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export async function readMonth(supabase: SupabaseClient, startsOn: string): Promise<Month | null> {
  const { data, error } = await supabase
    .from("months")
    .select(MONTH_FIELDS)
    .eq("starts_on", startsOn)
    .maybeSingle();
  if (error) throw new Error(`Could not read the month: ${error.message}`);
  if (!data) return null;
  const month = data as unknown as Month;
  return {
    ...month,
    bills: [...month.bills]
      .sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name))
      .map((bill) => ({
        ...bill,
        amount: money(bill.amount),
        personal_charges: bill.personal_charges.map((c) => ({ ...c, amount: Number(c.amount) })),
      })),
    direct_payments: month.direct_payments.map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}

// The months that have been opened, newest first, as "YYYY-MM-01".
export async function listOpenedMonths(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("months")
    .select("starts_on")
    .order("starts_on", { ascending: false });
  if (error) throw new Error(`Could not list the months: ${error.message}`);
  return ((data ?? []) as { starts_on: string }[]).map((row) => row.starts_on);
}

// Which month a page shows: the ?month=YYYY-MM asked for, if that month
// has been opened, otherwise the month the household is in.
export function chosenMonth(asked: string | undefined, opened: string[], today: string): string {
  const wanted = asked && /^\d{4}-\d{2}$/.test(asked) ? `${asked}-01` : null;
  return wanted && opened.includes(wanted) ? wanted : monthStart(today);
}

// The months the picker offers: every opened one plus the month now
// running, even before it's opened.
export function pickableMonths(opened: string[], today: string): string[] {
  return [...new Set([monthStart(today), ...opened])].sort().reverse();
}

// A bill is entered once it has an amount; a card statement also needs
// its personal-charges question settled — "no", or "yes" with at least
// one charge declared (REQ-54: it can't be skipped silently).
export function billEntered(bill: MonthBill): boolean {
  if (bill.amount === null) return false;
  if (bill.kind !== "card") return true;
  if (bill.personal_answer === "none") return true;
  return bill.personal_answer === "some" && bill.personal_charges.length > 0;
}

// The header chip (DESIGN.md §7). A month not opened, or with a bill
// still to enter, is Incomplete (REQ-53). Squared and Closed come with
// payments and closing.
export function monthStatus(month: Month | null): "Incomplete" | "Open" {
  return month && month.bills.every(billEntered) ? "Open" : "Incomplete";
}

const cents = (amount: number) => Math.round(amount * 100);

export type PersonTotals = {
  user_id: string;
  // Their percentage of the shared base.
  share: number;
  // Personal charges that are theirs in full.
  personal: number;
  // Direct payments they already paid for the household.
  fronted: number;
  // What the month asks of them: share + personal.
  obligation: number;
};

export type MonthTotals = {
  // Every bill entered: that month's statements plus that month's rent.
  expenses: number;
  personal: number;
  direct: number;
  // What gets split: expenses − personal charges + direct payments.
  sharedBase: number;
  people: PersonTotals[];
};

// REQ-53, 54, 55: the month's money, in dollars, worked out in cents so
// nothing drifts. Each share is rounded to the cent on its own.
export function monthTotals(month: Month, shares: Share[]): MonthTotals {
  const expenses = month.bills.reduce((sum, bill) => sum + cents(bill.amount ?? 0), 0);
  const charges = month.bills.flatMap((bill) => bill.personal_charges);
  const personal = charges.reduce((sum, charge) => sum + cents(charge.amount), 0);
  const direct = month.direct_payments.reduce((sum, payment) => sum + cents(payment.amount), 0);
  const sharedBase = expenses - personal + direct;
  const people = shares.map((share) => {
    const part = Math.round((sharedBase * share.percent) / 100);
    const own = charges
      .filter((charge) => charge.owner_id === share.user_id)
      .reduce((sum, charge) => sum + cents(charge.amount), 0);
    const fronted = month.direct_payments
      .filter((payment) => payment.payer_id === share.user_id)
      .reduce((sum, payment) => sum + cents(payment.amount), 0);
    return {
      user_id: share.user_id,
      share: part / 100,
      personal: own / 100,
      fronted: fronted / 100,
      obligation: (part + own) / 100,
    };
  });
  return {
    expenses: expenses / 100,
    personal: personal / 100,
    direct: direct / 100,
    sharedBase: sharedBase / 100,
    people,
  };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Due 1 Sep", as the design writes it: the bill's day in the month it's
// in (a 31st falls on the 30th in September). A fixed list, because
// locales disagree on the short names ("Sept" in en-GB).
export function dueInMonth(dueDay: number, startsOn: string): string {
  const [year, month] = startsOn.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `Due ${Math.min(dueDay, lastDay)} ${SHORT_MONTHS[month - 1]}`;
}
