"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../../lib/auth/permissions";
import { householdToday } from "../../../lib/finances/budget-year";
import { isIncomeKind } from "../../../lib/finances/leftover";
import { parseAmount } from "../../../lib/finances/money";
import { createClient } from "../../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

// Logging income is shared, like entering: any member logs it for
// either person (REQ-60).
async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) {
    redirect("/finances");
  }
  return supabase;
}

function refresh() {
  revalidatePath("/finances", "layout");
}

// Why the database refused, in words.
function refused(message: string): string {
  if (message.includes("month is closed")) return "This month is closed. Nothing was saved.";
  if (message.includes("duplicate key")) return "That paycheck is already confirmed.";
  return message;
}

// REQ-60: money that landed — its kind, whose it is, how much and the
// day. A paycheck confirmed from the income setup also carries which
// source and payday it was, so it drops off the expected list.
export async function logIncome(_previous: FormState, formData: FormData): Promise<FormState> {
  const monthId = String(formData.get("monthId") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const amount = parseAmount(String(formData.get("amount") ?? ""));
  const receivedOn = String(formData.get("receivedOn") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "") || null;
  const note = String(formData.get("note") ?? "").trim();
  if (!ownerId) return { error: "Whose income is it?" };
  if (!isIncomeKind(kind)) return { error: "Choose what kind of income it is." };
  if (amount === null) return { error: "Enter the amount, like 2400.00." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) return { error: "Enter the day it landed." };

  const supabase = await requireMember();
  const { data: month } = await supabase.from("months").select("starts_on").eq("id", monthId).maybeSingle();
  const startsOn = (month as { starts_on: string } | null)?.starts_on;
  if (!startsOn || receivedOn.slice(0, 7) !== startsOn.slice(0, 7)) {
    return { error: "The day it landed has to be in this month." };
  }
  if (receivedOn > householdToday()) return { error: "Only money that has landed counts, so the day can't be in the future." };

  const { error } = await supabase.from("month_income").insert({
    month_id: monthId,
    owner_id: ownerId,
    kind,
    amount,
    received_on: receivedOn,
    income_source_id: sourceId,
    note,
  });
  if (error) return { error: refused(error.message) };
  refresh();
  return { saved: true };
}

export async function removeIncome(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await requireMember();
  const { error } = await supabase.from("month_income").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the income: ${refused(error.message)}`);
  refresh();
}
