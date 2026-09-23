"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../../lib/auth/permissions";
import { formatMoney, parseAmount } from "../../../lib/finances/money";
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

type BillWithPayments = {
  name: string;
  amount: string | number | null;
  payments: { id: string; amount: string | number }[];
};

// REQ-57: who paid, how much, and which bill it went to. With an id it
// changes a payment already logged. A payment bigger than what's left on
// the bill is refused with the amount left; the database refuses it too
// (check_bill_payments), so this only puts the reason in words.
export async function savePayment(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "") || null;
  const payerId = String(formData.get("payerId") ?? "");
  const billId = String(formData.get("monthBillId") ?? "");
  const amount = parseAmount(String(formData.get("amount") ?? ""));
  if (!payerId) return { error: "Who paid?" };
  if (amount === null) return { error: "Enter the amount, like 180.00." };
  if (!billId) return { error: "Which bill did it go to?" };

  const supabase = await requireMember();
  const { data } = await supabase
    .from("month_bills")
    .select("name, amount, payments(id, amount)")
    .eq("id", billId)
    .maybeSingle();
  const bill = data as BillWithPayments | null;
  if (!bill) return { error: "That bill isn't in this month." };
  if (bill.amount === null) return { error: `Enter ${bill.name}'s amount before paying toward it.` };
  const paidCents = bill.payments
    .filter((payment) => payment.id !== id)
    .reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
  const leftCents = Math.round(Number(bill.amount) * 100) - paidCents;
  if (Math.round(amount * 100) > leftCents) {
    return {
      error:
        leftCents <= 0
          ? `${bill.name} is already paid in full. Nothing was saved.`
          : `That's more than the ${formatMoney(leftCents / 100)} left on ${bill.name}. Nothing was saved.`,
    };
  }

  const row = { payer_id: payerId, month_bill_id: billId, amount };
  const { error } = id
    ? await supabase.from("payments").update(row).eq("id", id)
    : await supabase.from("payments").insert(row);
  if (error) {
    return {
      error: error.message.includes("more than the bill")
        ? `That's more than what's left on ${bill.name}. Nothing was saved.`
        : error.message,
    };
  }
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
