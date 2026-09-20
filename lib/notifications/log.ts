import type { SupabaseClient } from "@supabase/supabase-js";

// REQ-22. Reading the notification log for the admin console.

export type LogRow = {
  id: string;
  sent_at: string;
  trigger: "hourly" | "manual";
  user_id: string;
  device: string;
  delivered_at: string | null;
  tapped_at: string | null;
  accepted: boolean;
  failure_code: number | null;
};

// How long a send waits for a delivery before we call it missing. The
// requirement sets five minutes and says to tighten it later: a push
// service may legitimately hold a message for a phone that is off or out
// of signal, so a short wait would cry wolf.
export const MISSING_AFTER_MS = 5 * 60 * 1000;

// How far back the console shows. The requirement asks for at least
// seven days; the rows themselves are kept for thirty.
export const SHOW_DAYS = 7;

export type Status = "refused" | "tapped" | "delivered" | "waiting" | "missing";

// Deliberately a plain function of a row and a clock, with no database in
// it, so every branch can be tested directly.
export function statusOf(row: LogRow, now: number): Status {
  if (row.tapped_at) {
    return "tapped";
  }
  if (row.delivered_at) {
    return "delivered";
  }
  // A send the push service refused never had a chance to arrive, and
  // saying "missing" would blame the wrong thing.
  if (!row.accepted) {
    return "refused";
  }
  const waited = now - new Date(row.sent_at).getTime();
  return waited >= MISSING_AFTER_MS ? "missing" : "waiting";
}

export async function listRecentLog(
  supabase: SupabaseClient,
  days: number = SHOW_DAYS,
): Promise<LogRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("notification_log")
    .select(
      "id, sent_at, trigger, user_id, device, delivered_at, tapped_at, accepted, failure_code",
    )
    .gte("sent_at", since.toISOString())
    .order("sent_at", { ascending: false });
  if (error) {
    throw new Error(`Could not read the notification log: ${error.message}`);
  }
  return (data ?? []) as LogRow[];
}

// What the admin actually wants to know at a glance: of what was sent in
// the window, how much arrived.
export function summarise(rows: LogRow[], now: number) {
  const counted = rows.map((row) => statusOf(row, now));
  const arrived = counted.filter(
    (status) => status === "delivered" || status === "tapped",
  ).length;
  const settled = counted.filter((status) => status !== "waiting").length;
  return {
    sent: rows.length,
    arrived,
    missing: counted.filter((status) => status === "missing").length,
    refused: counted.filter((status) => status === "refused").length,
    waiting: counted.filter((status) => status === "waiting").length,
    // Out of the sends we already know the answer for. Counting the ones
    // still in flight as failures would make every fresh send look bad.
    reliability: settled === 0 ? null : Math.round((arrived / settled) * 100),
  };
}
