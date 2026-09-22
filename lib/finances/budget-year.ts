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

// A budget year runs April to March and is named by the year its April
// falls in: 2026 covers April 2026 to March 2027 (REQ-50).
export function budgetYearStartFor(day: string): number {
  const [year, month] = day.split("-").map(Number);
  return month >= 4 ? year : year - 1;
}

export function budgetYearLabel(startYear: number): string {
  return `April ${startYear} – March ${startYear + 1}`;
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

export function formatPercent(hundredths: number): string {
  return `${(hundredths / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

export type Person = { user_id: string; name: string; manages_budget: boolean };
export type Share = { user_id: string; percent: number };
export type BudgetYear = { id: string; start_year: number; note: string; shares: Share[] };

export async function listPeople(supabase: SupabaseClient): Promise<Person[]> {
  const { data, error } = await supabase.rpc("household_people");
  if (error) throw new Error(`Could not list the household: ${error.message}`);
  return (data ?? []) as Person[];
}

export async function readBudgetYear(
  supabase: SupabaseClient,
  startYear: number,
): Promise<BudgetYear | null> {
  const { data, error } = await supabase
    .from("budget_years")
    .select("id, start_year, note, shares:budget_year_shares(user_id, percent)")
    .eq("start_year", startYear)
    .maybeSingle();
  if (error) throw new Error(`Could not read the budget year: ${error.message}`);
  if (!data) return null;
  const year = data as unknown as BudgetYear;
  return { ...year, shares: year.shares.map((s) => ({ ...s, percent: Number(s.percent) })) };
}
