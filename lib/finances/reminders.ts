import { createAdminClient } from "../supabase/admin";
import { sendPush } from "../notifications/send";
import { pushesDue } from "./action-items";
import { HOUSEHOLD_TIME_ZONE, householdToday } from "./budget-year";
import { householdForJob, readFinanceSnapshot } from "./snapshot";

// REQ-70's sending, run hourly by the database's clock. Reminders go out
// only in the household's waking hours; outside them the job does nothing
// and whatever is due goes at nine.
export const FIRST_HOUR = 9;
export const LAST_HOUR = 21;

export function householdHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSEHOLD_TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

export async function sendFinanceReminders({ subject, now = new Date() }: { subject: string; now?: Date }) {
  const hour = householdHour(now);
  if (hour < FIRST_HOUR || hour >= LAST_HOUR) return { sent: 0, quiet: true };

  const admin = createAdminClient();
  const people = await householdForJob(admin);
  const snapshot = await readFinanceSnapshot(admin, householdToday(now), people);
  const { data: sent, error } = await admin.from("finance_pushes").select("user_id, topic");
  if (error) throw new Error(`Could not read the pushes sent: ${error.message}`);

  let delivered = 0;
  for (const push of pushesDue(snapshot, (sent ?? []) as { user_id: string; topic: string }[])) {
    // Claimed before sending, so two runs that overlap can't both send it.
    // Only the run whose row went in goes on.
    const { data: claimed, error: claimError } = await admin
      .from("finance_pushes")
      .upsert({ user_id: push.user_id, topic: push.topic }, { onConflict: "user_id,topic", ignoreDuplicates: true })
      .select("topic");
    if (claimError) throw new Error(`Could not record the push: ${claimError.message}`);
    if (!claimed || claimed.length === 0) continue;
    const summary = await sendPush({
      subject,
      trigger: "finances",
      to: [push.user_id],
      message: { title: "Finances", body: push.body, url: push.url },
    });
    delivered += summary.delivered;
  }
  return { sent: delivered, quiet: false };
}
