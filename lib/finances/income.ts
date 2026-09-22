import type { SupabaseClient } from "@supabase/supabase-js";

// Pay as it lands (REQ-51): a net amount per payment, how often it comes,
// and one known payday to count from. Dates are plain "YYYY-MM-DD" days,
// worked on in UTC so no clock change can move a payday.
export const CADENCES = {
  weekly: "Every week",
  biweekly: "Every two weeks",
  monthly: "Every month",
} as const;

export type Cadence = keyof typeof CADENCES;

export function isCadence(value: string): value is Cadence {
  return Object.hasOwn(CADENCES, value);
}

export type IncomeSource = {
  id: string;
  owner_id: string;
  net_amount: number;
  cadence: Cadence;
  anchor_date: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(day: Date): string {
  return day.toISOString().slice(0, 10);
}

// The same day of the month as the anchor, or the month's last day when
// the month is shorter (an anchor on the 31st pays on 28 February).
function monthlyPayday(anchor: Date, year: number, month: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay)));
}

// The next `count` paydays on or after `from`. The anchor is any one real
// payday; paydays before it count too, so it needn't be the first.
export function payDates(
  source: Pick<IncomeSource, "cadence" | "anchor_date">,
  from: string,
  count: number,
): string[] {
  const anchor = toDay(source.anchor_date);
  const start = toDay(from);
  const dates: string[] = [];

  if (source.cadence === "monthly") {
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth();
    while (dates.length < count) {
      const payday = monthlyPayday(anchor, year, month);
      if (payday >= start) dates.push(toIso(payday));
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
    return dates;
  }

  const step = (source.cadence === "weekly" ? 7 : 14) * DAY_MS;
  const stepsToStart = Math.ceil((start.getTime() - anchor.getTime()) / step);
  for (let i = 0; i < count; i += 1) {
    dates.push(toIso(new Date(anchor.getTime() + (stepsToStart + i) * step)));
  }
  return dates;
}

export async function listIncomeSources(supabase: SupabaseClient): Promise<IncomeSource[]> {
  const { data, error } = await supabase
    .from("income_sources")
    .select("id, owner_id, net_amount, cadence, anchor_date")
    .order("created_at");
  if (error) throw new Error(`Could not list income sources: ${error.message}`);
  return ((data ?? []) as IncomeSource[]).map((s) => ({ ...s, net_amount: Number(s.net_amount) }));
}
