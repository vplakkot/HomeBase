"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../../lib/auth/permissions";
import { formatPercent, householdToday, parsePercent } from "../../../lib/finances/budget-year";
import { parseAmount } from "../../../lib/finances/money";
import { createClient } from "../../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

// Entering is shared, not per person (REQ-53): any member may do it.
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

// A statement can come to nothing, so zero is allowed here.
function parseStatement(text: string): number | null {
  return /^\s*\$?0+(\.0{1,2})?\s*$/.test(text) ? 0 : parseAmount(text);
}

// Opens the month the household is in, copying the bill list into it.
export async function openMonth(): Promise<void> {
  const supabase = await requireMember();
  const today = householdToday();
  const { error } = await supabase.rpc("open_month", { p_month: today, p_today: today });
  if (error) throw new Error(`Could not open the month: ${error.message}`);
  refresh();
}

// REQ-53, REQ-54: a bill's amount; a card statement also needs the
// answer to "any personal charges still inside it?".
export async function enterBill(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const amount = parseStatement(String(formData.get("amount") ?? ""));
  const answer = formData.get("personal");
  if (!id) return { error: "That bill isn't in this month." };
  if (amount === null) return { error: "Enter the amount, like 1850.00." };
  if (kind === "card" && answer !== "none" && answer !== "some") {
    return { error: "Say whether any personal charges are still inside this statement." };
  }

  const supabase = await requireMember();
  const { error } = await supabase.rpc("enter_bill", {
    p_month_bill: id,
    p_amount: amount,
    p_personal_answer: kind === "card" ? answer : null,
  });
  if (error) {
    return {
      error: error.message.includes("more than the statement")
        ? "The personal charges already declared come to more than that. Remove some first."
        : error.message.includes("more than the bill")
          ? "More than that has already been paid toward this bill. Change the payments first."
          : error.message,
    };
  }
  refresh();
  return { saved: true };
}

// REQ-54: an amount, whose it is, and an optional note.
export async function addPersonalCharge(_previous: FormState, formData: FormData): Promise<FormState> {
  const monthBillId = String(formData.get("monthBillId") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "");
  const amount = parseAmount(String(formData.get("amount") ?? ""));
  const note = String(formData.get("note") ?? "").trim();
  if (!ownerId) return { error: "Whose charge is it?" };
  if (amount === null) return { error: "Enter the charge's amount, like 45.00." };

  const supabase = await requireMember();
  const { error } = await supabase
    .from("personal_charges")
    .insert({ month_bill_id: monthBillId, owner_id: ownerId, amount, note });
  if (error) {
    return {
      error: error.message.includes("more than the statement")
        ? "Personal charges can't come to more than the statement."
        : error.message,
    };
  }
  refresh();
  return { saved: true };
}

export async function removePersonalCharge(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await requireMember();
  const { error } = await supabase.from("personal_charges").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the charge: ${error.message}`);
  refresh();
}

// REQ-55: the payer, the total, the day it was paid and a note. The day
// falls in the payment's month and isn't later than today.
export async function addDirectPayment(_previous: FormState, formData: FormData): Promise<FormState> {
  const monthId = String(formData.get("monthId") ?? "");
  const payerId = String(formData.get("payerId") ?? "");
  const amount = parseAmount(String(formData.get("amount") ?? ""));
  const paidOn = String(formData.get("paidOn") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!payerId) return { error: "Who paid?" };
  if (amount === null) return { error: "Enter the total, like 64.20." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: "Enter the date it was paid." };
  if (!note) return { error: "Add a note saying what it was for." };

  const supabase = await requireMember();
  const { data: month } = await supabase.from("months").select("starts_on").eq("id", monthId).maybeSingle();
  const startsOn = (month as { starts_on: string } | null)?.starts_on;
  if (!startsOn || paidOn.slice(0, 7) !== startsOn.slice(0, 7)) {
    return { error: "The date paid has to be in this month." };
  }
  if (paidOn > householdToday()) return { error: "A One-time Payment is already paid, so its date can't be in the future." };

  const { error } = await supabase
    .from("direct_payments")
    .insert({ month_id: monthId, payer_id: payerId, amount, note, paid_on: paidOn });
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

export async function removeDirectPayment(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await requireMember();
  const { error } = await supabase.from("direct_payments").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the payment: ${error.message}`);
  refresh();
}

// REQ-148: an earlier month of this budget year, never opened, added
// now. It opens like any month and goes straight to its entry.
export async function addPastMonth(formData: FormData): Promise<void> {
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const supabase = await requireMember();
  const { error } = await supabase.rpc("add_past_month", { p_month: `${month}-01`, p_today: householdToday() });
  // With no split yet, Finances home says how to set the year up.
  if (error?.message.includes("Set up the budget year first")) redirect("/finances");
  // Added a moment ago by the other person: it's there either way.
  if (error && !error.message.includes("already there")) throw new Error(`Could not add the month: ${error.message}`);
  refresh();
  redirect(`/finances/monthly-entry?month=${month}`);
}

const SHARE_FIELD = "share_";

// REQ-148: a month added later has its own split, which either of us may
// change for that month only. The household's splits stay as they are.
export async function setMonthSplit(_previous: FormState, formData: FormData): Promise<FormState> {
  const monthId = String(formData.get("monthId") ?? "");
  const shares: { user_id: string; percent: number }[] = [];
  for (const [field, value] of formData.entries()) {
    if (!field.startsWith(SHARE_FIELD)) continue;
    const hundredths = parsePercent(String(value));
    if (hundredths === null) return { error: "Each percentage must be a number from 0 to 100, with at most two decimals." };
    shares.push({ user_id: field.slice(SHARE_FIELD.length), percent: hundredths / 100 });
  }
  if (!monthId || shares.length === 0) return { error: "Give each person a percentage." };
  const total = shares.reduce((sum, share) => sum + Math.round(share.percent * 100), 0);
  if (total !== 100_00) return { error: `The percentages add up to ${formatPercent(total)}. They must total 100%.` };

  const supabase = await requireMember();
  const { error } = await supabase.rpc("set_month_split", { p_month: monthId, p_shares: shares });
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// REQ-148: we sorted a month added later out between us, outside the
// app. It closes with nobody owing anything for it.
export async function settleMonth(_previous: FormState, formData: FormData): Promise<FormState> {
  const monthId = String(formData.get("monthId") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!monthId || !/^\d{4}-\d{2}$/.test(month)) return { error: "That month isn't there." };
  const supabase = await requireMember();
  const { error } = await supabase.rpc("settle_past_month", { p_month: monthId });
  if (error) {
    return {
      error: error.message.includes("Enter every bill")
        ? "Enter every bill first ($0 is fine), so the year's totals have the whole month."
        : error.message,
    };
  }
  refresh();
  redirect(`/finances?month=${month}`);
}

