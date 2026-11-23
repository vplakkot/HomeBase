import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { householdToday, listPeople } from "../finances/budget-year";
import { FIRST_HOUR, LAST_HOUR, householdHour } from "../finances/reminders";
import { isSwitchedOff } from "../module-switches";
import { sendPush } from "../notifications/send";
import { createAdminClient } from "../supabase/admin";
import { dietMessage, remindersDue } from "./messages";
import { readPets, type Diet } from "./pets";

// REQ-190 and REQ-192: sending the Pets notifications. Anything someone
// does goes to everyone else at once; a diet change waits until nobody has
// touched that diet for five minutes; date-based reminders go to everyone.

export const DIET_QUIET_MINUTES = 5;

const TITLE = "Pets";

type Admin = ReturnType<typeof createAdminClient>;

// Everyone in the household except the person who did it.
async function others(admin: Admin, actor: string | null): Promise<string[]> {
  const { data, error } = await admin.from("household_members").select("user_id");
  if (error) throw new Error(`Could not read the household: ${error.message}`);
  return ((data ?? []) as { user_id: string }[]).map((row) => row.user_id).filter((id) => id !== actor);
}

// The signed-in person's id and first name, for "Vin gave Livy Simparica Trio."
export async function whoIsActing(supabase: SupabaseClient): Promise<{ id: string | null; name: string }> {
  const { data } = await supabase.auth.getClaims();
  const id = (data?.claims?.sub as string | undefined) ?? null;
  try {
    const people = await listPeople(supabase);
    return { id, name: people.find((person) => person.user_id === id)?.name || "Someone" };
  } catch {
    return { id, name: "Someone" };
  }
}

// The address pushes are sent "from": this app's own, as the push
// services require a contact.
async function subjectFromRequest(): Promise<string | null> {
  const host = (await headers()).get("host");
  return host ? `https://${host}` : null;
}

// Tell everyone but `actor` something that just happened. Never throws: the
// change is already saved, and a notification that couldn't go must not
// make the save look as though it failed.
export async function tellOthers({ actor, body, url = "/pets" }: { actor: string | null; body: string; url?: string }): Promise<void> {
  try {
    const subject = await subjectFromRequest();
    if (!subject) return;
    const admin = createAdminClient();
    if (await isSwitchedOff(admin, "pets")) return;
    const to = await others(admin, actor);
    if (to.length === 0) return;
    await sendPush({ subject, trigger: "pets", to, message: { title: TITLE, body, url } });
  } catch (reason) {
    console.error("Could not send a Pets notification", reason);
  }
}

// A diet changed. The first edit of a burst keeps the diet as it was; later
// ones only restart the five minutes. Never throws, for the same reason.
export async function queueDietChange({ petId, actor, before }: { petId: string; actor: string | null; before: Diet | null }): Promise<void> {
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const first = await admin
      .from("pet_diet_pending")
      .upsert({ pet_id: petId, actor, before_diet: before, last_edit_at: now }, { onConflict: "pet_id", ignoreDuplicates: true });
    if (first.error) throw new Error(first.error.message);
    const later = await admin.from("pet_diet_pending").update({ actor, last_edit_at: now }).eq("pet_id", petId);
    if (later.error) throw new Error(later.error.message);
  } catch (reason) {
    console.error("Could not queue a diet notification", reason);
  }
}

// The job: every five minutes, from the database's clock.
export async function runPetSchedule({ subject, now = new Date() }: { subject: string; now?: Date }) {
  const admin = createAdminClient();
  // While Pets is off nothing is sent. Pending changes wait, and are sent when it is back
  // if they are still worth telling (a diet that changed back says nothing).
  if (await isSwitchedOff(admin, "pets")) return { diets: 0, reminders: 0, quiet: true };

  const diets = await sendQuietDietChanges(admin, subject, now);

  const hour = householdHour(now);
  if (hour < FIRST_HOUR || hour >= LAST_HOUR) return { diets, reminders: 0, quiet: true };
  const today = householdToday(now);
  const data = await readPets(admin);
  let reminders = 0;
  for (const reminder of remindersDue(data, today)) {
    // Claimed before sending, so two runs that overlap can't both send it.
    const { data: claimed, error } = await admin
      .from("pet_pushes")
      .upsert({ topic: reminder.topic }, { onConflict: "topic", ignoreDuplicates: true })
      .select("topic");
    if (error) throw new Error(`Could not record the reminder: ${error.message}`);
    if (!claimed || claimed.length === 0) continue;
    const summary = await sendPush({
      subject,
      trigger: "pets",
      to: null,
      message: { title: TITLE, body: reminder.body, url: reminder.url },
    });
    reminders += summary.delivered;
  }
  return { diets, reminders, quiet: false };
}

async function sendQuietDietChanges(admin: Admin, subject: string, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DIET_QUIET_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from("pet_diet_pending")
    .select("pet_id, actor, before_diet, last_edit_at")
    .lte("last_edit_at", cutoff);
  if (error) throw new Error(`Could not read the waiting diet changes: ${error.message}`);
  let sent = 0;
  for (const row of (data ?? []) as { pet_id: string; actor: string | null; before_diet: Diet | null; last_edit_at: string }[]) {
    // Claimed by deleting the row we read: an edit that came in meanwhile
    // changed last_edit_at, so it isn't deleted and waits its own five minutes.
    const { data: claimed, error: claimError } = await admin
      .from("pet_diet_pending")
      .delete()
      .eq("pet_id", row.pet_id)
      .eq("last_edit_at", row.last_edit_at)
      .select("pet_id");
    if (claimError) throw new Error(`Could not claim a diet change: ${claimError.message}`);
    if (!claimed || claimed.length === 0) continue;

    const { data: pet } = await admin.from("pets").select("name, archived_at").eq("id", row.pet_id).maybeSingle();
    const { data: diet } = await admin
      .from("pet_diets")
      .select("id, kind, brand, product, protein, batch_prep_on, food_runs_out_on, grams_per_meal, meals_per_day, started_on")
      .eq("pet_id", row.pet_id)
      .is("ended_on", null)
      .maybeSingle();
    const named = pet as { name: string; archived_at: string | null } | null;
    // An archived pet, a pet or diet since removed, says nothing.
    if (!named || named.archived_at !== null || !diet) continue;
    const body = dietMessage(named.name, row.before_diet, { ...(diet as Diet), grams_per_meal: Number((diet as Diet).grams_per_meal) }, householdToday(now));
    if (!body) continue;
    const to = await others(admin, row.actor);
    if (to.length === 0) continue;
    const summary = await sendPush({ subject, trigger: "pets", to, message: { title: TITLE, body, url: `/pets/${row.pet_id}` } });
    sent += summary.delivered;
  }
  return sent;
}
