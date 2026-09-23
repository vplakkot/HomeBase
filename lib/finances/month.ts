import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillKind } from "./bills";
import { monthStart, type Share } from "./budget-year";

// A month of household spending (REQ-53, 54, 55). Opening it copies the
// bill list in; members then enter each bill's amount, declare personal
// charges inside card statements, log shared spend one of them paid (a
// "one-time payment" on screen), and log payments toward the bills
// (REQ-57).

export type PersonalCharge = { id: string; owner_id: string; amount: number; note: string };
export type DirectPayment = { id: string; payer_id: string; amount: number; note: string; paid_on: string };
export type Payment = { id: string; payer_id: string; amount: number; created_at: string };
export type MonthBill = {
  id: string;
  name: string;
  kind: BillKind;
  due_day: number;
  amount: number | null;
  personal_answer: "none" | "some" | null;
  personal_charges: PersonalCharge[];
  payments: Payment[];
};
export type Month = {
  id: string;
  starts_on: string;
  bills: MonthBill[];
  direct_payments: DirectPayment[];
};

const MONTH_FIELDS = `id, starts_on,
  bills:month_bills(id, name, kind, due_day, amount, personal_answer,
    personal_charges(id, owner_id, amount, note),
    payments(id, payer_id, amount, created_at)),
  direct_payments(id, payer_id, amount, note, paid_on)`;

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
        payments: [...bill.payments]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((p) => ({ ...p, amount: Number(p.amount) })),
      })),
    direct_payments: [...month.direct_payments]
      .sort((a, b) => a.paid_on.localeCompare(b.paid_on))
      .map((p) => ({ ...p, amount: Number(p.amount) })),
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
const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + cents(amount), 0);

export type PersonTotals = {
  user_id: string;
  percent: number;
  // Their percentage of the shared base.
  share: number;
  // Personal charges that are theirs in full.
  personal: number;
  // What the month asks of them: share + personal.
  obligation: number;
  // One-time payments they already paid for the household.
  fronted: number;
  // Payments they logged toward the bills.
  paidToBills: number;
  // fronted + paidToBills.
  paid: number;
  // obligation − paid; below zero is a credit (REQ-57).
  outstanding: number;
};

export type BillTotals = { id: string; total: number; paid: number; left: number };

export type MonthTotals = {
  // Every bill entered: that month's statements plus that month's rent.
  expenses: number;
  personal: number;
  direct: number;
  // What gets split: expenses − personal charges + direct payments.
  sharedBase: number;
  people: PersonTotals[];
  bills: BillTotals[];
};

// REQ-56, 57, 58: the month's money, in dollars, worked out in cents so
// nothing drifts. Each share is rounded to the cent, and the last person
// takes whatever cent the rounding left over, so the shares always add
// up to the shared base exactly. People are put in a fixed order first,
// since the database hands them back in any order, so the same person
// always gets that cent. A one-time payment counts as paid by whoever
// fronted it: they already spent it on the household.
export function monthTotals(month: Month, unordered: Share[]): MonthTotals {
  const shares = [...unordered].sort((a, b) => a.user_id.localeCompare(b.user_id));
  const charges = month.bills.flatMap((bill) => bill.personal_charges);
  const payments = month.bills.flatMap((bill) => bill.payments);
  const expenses = sum(month.bills.map((bill) => bill.amount ?? 0));
  const personal = sum(charges.map((charge) => charge.amount));
  const direct = sum(month.direct_payments.map((payment) => payment.amount));
  const sharedBase = expenses - personal + direct;
  let unshared = sharedBase;
  const people = shares.map((share, index) => {
    const part = index === shares.length - 1 ? unshared : Math.round((sharedBase * share.percent) / 100);
    unshared -= part;
    const theirs = <T extends { amount: number }>(rows: T[], who: (row: T) => string) =>
      sum(rows.filter((row) => who(row) === share.user_id).map((row) => row.amount));
    const own = theirs(charges, (charge) => charge.owner_id);
    const fronted = theirs(month.direct_payments, (payment) => payment.payer_id);
    const toBills = theirs(payments, (payment) => payment.payer_id);
    return {
      user_id: share.user_id,
      percent: share.percent,
      share: part / 100,
      personal: own / 100,
      obligation: (part + own) / 100,
      fronted: fronted / 100,
      paidToBills: toBills / 100,
      paid: (fronted + toBills) / 100,
      outstanding: (part + own - fronted - toBills) / 100,
    };
  });
  const bills = month.bills.map((bill) => {
    const total = cents(bill.amount ?? 0);
    const paid = sum(bill.payments.map((payment) => payment.amount));
    return { id: bill.id, total: total / 100, paid: paid / 100, left: (total - paid) / 100 };
  });
  return {
    expenses: expenses / 100,
    personal: personal / 100,
    direct: direct / 100,
    sharedBase: sharedBase / 100,
    people,
    bills,
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

// "5 Sep", as the design writes a day.
export function dayLabel(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${SHORT_MONTHS[month - 1]}`;
}
