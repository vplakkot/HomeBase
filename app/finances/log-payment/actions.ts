"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../../lib/auth/permissions";
import { parseAmount } from "../../../lib/finances/money";
import { createClient } from "../../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

// Logging is shared, like entering: any member logs a payment for either
// person (REQ-57).
async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) {
    redirect("/finances");
  }
  return supabase;
}

// REQ-57: who paid, how much, on what day, and which bill it went to.
// With an id it changes a payment already logged. There's no ceiling: a
// payment bigger than what's left on the bill is recorded as it happened
// and shows as a credit (Vin, 2026-09-29).
export async function savePayment(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "") || null;
  const payerId = String(formData.get("payerId") ?? "");
  const billId = String(formData.get("monthBillId") ?? "");
  const amount = parseAmount(String(formData.get("amount") ?? ""));
  const paidOn = String(formData.get("paidOn") ?? "");
  if (!payerId) return { error: "Who paid?" };
  if (amount === null) return { error: "Enter the amount, like 180.00." };
  if (!billId) return { error: "Which bill did it go to?" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn))) return { error: "Pick the day it was paid." };

  const supabase = await requireMember();
  const { data } = await supabase.from("month_bills").select("name, amount").eq("id", billId).maybeSingle();
  const bill = data as { name: string; amount: string | number | null } | null;
  if (!bill) return { error: "That bill isn't in this month." };
  if (bill.amount === null) return { error: `Enter ${bill.name}'s amount before paying toward it.` };

  const row = { payer_id: payerId, month_bill_id: billId, amount, paid_on: paidOn };
  const { data: written, error } = id
    ? await supabase.from("payments").update(row).eq("id", id).select("id")
    : await supabase.from("payments").insert(row);
  if (id && !error && (written ?? []).length === 0) {
    return { error: "That payment was deleted in the meantime. Nothing was saved." };
  }
  if (error) return { error: error.message };
  revalidatePath("/finances", "layout");
  return { saved: true };
}

export async function deletePayment(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await requireMember();
  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) throw new Error(`Could not delete the payment: ${error.message}`);
  revalidatePath("/finances", "layout");
}
