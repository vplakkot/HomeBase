import type { SupabaseClient } from "@supabase/supabase-js";

// The household's recurring bills (REQ-94). Monthly entry and the bill
// rows on Finances home both work from this one list.
export const BILL_KINDS = { rent: "Rent", card: "Card", other: "Other" } as const;

export type BillKind = keyof typeof BILL_KINDS;

export function isBillKind(value: string): value is BillKind {
  return Object.hasOwn(BILL_KINDS, value);
}

// Rent carries its monthly amount, since it's the same every month
// (Vin, 2026-09-23); a card or other bill is entered month by month.
export type Bill = { id: string; name: string; kind: BillKind; due_day: number; amount: number | null };

export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

export function dueLabel(day: number): string {
  return `Due the ${ordinal(day)}`;
}

// A bill due on the 29th, 30th or 31st falls on the last day of a month
// that is shorter — February's 28th, say. Monthly entry works from this.
export function dueDateIn(day: number, year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const onDay = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(onDay).padStart(2, "0")}`;
}

export async function listBills(supabase: SupabaseClient): Promise<Bill[]> {
  const { data, error } = await supabase
    .from("bills")
    .select("id, name, kind, due_day, amount")
    .order("due_day")
    .order("name");
  if (error) throw new Error(`Could not list bills: ${error.message}`);
  // Postgres hands numeric columns back as strings.
  return ((data ?? []) as (Omit<Bill, "amount"> & { amount?: string | number | null })[]).map((bill) => ({
    ...bill,
    amount: bill.amount === null || bill.amount === undefined ? null : Number(bill.amount),
  }));
}
