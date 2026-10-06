import type { SupabaseClient } from "@supabase/supabase-js";

// Which day it is for the household, as "YYYY-MM-DD". Every Finances date
// decision reads this one clock, so the budget year, the month and the
// paydays can't disagree. The household is on the US east coast; changing
// the zone here moves them all together.
export const HOUSEHOLD_TIME_ZONE = "America/New_York";

export function householdToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSEHOLD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// A percentage as typed into the form, in hundredths so that 33.33 +
// 66.67 adds up to exactly 100 without floating-point drift. Null when it
// isn't a number from 0 to 100 with at most two decimals.
export function parsePercent(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return hundredths <= 100_00 ? hundredths : null;
}

// With two people the shares always add to 100, so typing one fills in the
// other: "60" gives "40", "33.33" gives "66.67". Nothing for text that isn't
// a share yet (empty, or half typed like "6."), so the other box is left alone.
export function otherShare(typed: string): string | null {
  const hundredths = parsePercent(typed);
  if (hundredths === null) return null;
  const rest = 100_00 - hundredths;
  return (rest / 100).toFixed(2).replace(/\.?0+$/, "");
}

// What the boxes hold after `who` is typed in: with exactly two people the
// other box is filled in too; otherwise only `who` changes.
export function withOtherShare(
  typed: Record<string, string>,
  ids: string[],
  who: string,
  value: string,
): Record<string, string> {
  const next = { ...typed, [who]: value };
  const other = ids.length === 2 ? ids.find((id) => id !== who) : undefined;
  const rest = other ? otherShare(value) : null;
  if (other && rest !== null) next[other] = rest;
  return next;
}

export function formatPercent(hundredths: number): string {
  return `${(hundredths / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

// The month a split starts, as "YYYY-MM-01", and how it reads.
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

// The budget year runs April to March (REQ-69). Its first month, as
// "YYYY-04-01", for the day given.
export function budgetYearStart(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return `${month < 4 ? year - 1 : year}-04-01`;
}

// REQ-148: every month of the budget year so far, oldest first, up to
// and including the one the day falls in.
export function budgetYearMonthsSoFar(day: string): string[] {
  const months: string[] = [];
  let [year, month] = budgetYearStart(day).split("-").map(Number);
  const last = monthStart(day);
  for (;;) {
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    if (first > last) return months;
    months.push(first);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
}

export function monthLabel(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type Person = { user_id: string; name: string; manages_budget: boolean };
export type Share = { user_id: string; percent: number };
export type Split = { id: string; effective_from: string; note: string; shares: Share[] };

export async function listPeople(supabase: SupabaseClient): Promise<Person[]> {
  const { data, error } = await supabase.rpc("household_people");
  if (error) throw new Error(`Could not list the household: ${error.message}`);
  return (data ?? []) as Person[];
}

// Every split the household has saved, newest first.
export async function listSplits(supabase: SupabaseClient): Promise<Split[]> {
  const { data, error } = await supabase
    .from("splits")
    .select("id, effective_from, note, shares:split_shares(user_id, percent)")
    .order("effective_from", { ascending: false });
  if (error) throw new Error(`Could not read the splits: ${error.message}`);
  return ((data ?? []) as unknown as Split[]).map((split) => ({
    ...split,
    shares: split.shares.map((share) => ({ ...share, percent: Number(share.percent) })),
  }));
}

// A split whose month has passed is history: changing it would rewrite
// what those months were worked out from. The month now running can
// still be changed — nothing has settled it yet — which is also what
// lets the first split be saved from this month.
export function splitIsHistory(split: Split, day: string): boolean {
  return split.effective_from < monthStart(day);
}

// The split a given month runs on: the latest one that had started by
// then. A month opened before any split exists has none.
export function splitInForce(splits: Split[], day: string): Split | null {
  const month = monthStart(day);
  return (
    [...splits]
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
      .find((split) => split.effective_from <= month) ?? null
  );
}
