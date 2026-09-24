"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../../lib/auth/permissions";
import { ACCOUNT_ORDER } from "../../../lib/finances/balances";
import { householdToday, monthStart } from "../../../lib/finances/budget-year";
import { parseAmount } from "../../../lib/finances/money";
import { createClient } from "../../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

// A balance can be zero (an emptied account), unlike a bill.
function balanceAmount(text: string): number | null {
  if (/^\$?0+(\.0{1,2})?$/.test(text)) return 0;
  return parseAmount(text);
}

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/finances");
  return supabase;
}

function balanceMonth(formData: FormData): string | null {
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}-01$/.test(month)) return null;
  return month <= monthStart(householdToday()) ? month : null;
}

// REQ-67: one person's balances for a month. A filled box is saved; a
// blank one is left out (or taken out, if it was entered before), so the
// rest still save and the gap shows. Any member enters either person's.
export async function saveBalances(_previous: FormState, formData: FormData): Promise<FormState> {
  const month = balanceMonth(formData);
  const userId = String(formData.get("userId") ?? "");
  if (!month || !userId) return { error: "Pick this month or an earlier one." };

  const rows = [];
  const cleared = [];
  for (const account of ACCOUNT_ORDER) {
    const text = String(formData.get(account) ?? "").trim();
    if (text === "") {
      cleared.push(account);
      continue;
    }
    const amount = balanceAmount(text);
    if (amount === null) return { error: "Enter amounts like 1200 or 1,200.50, or leave a box blank." };
    rows.push({ month, user_id: userId, account, amount, updated_at: new Date().toISOString() });
  }

  const supabase = await requireMember();
  if (rows.length > 0) {
    const { error } = await supabase.from("balances").upsert(rows, { onConflict: "month,user_id,account" });
    if (error) return { error: error.message };
  }
  if (cleared.length > 0) {
    const { error } = await supabase
      .from("balances")
      .delete()
      .eq("month", month)
      .eq("user_id", userId)
      .in("account", cleared);
    if (error) return { error: error.message };
  }
  revalidatePath("/finances", "layout");
  return { saved: true };
}

// Takes every balance for a month away, so a month entered by mistake
// never sticks.
export async function removeBalances(formData: FormData): Promise<void> {
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}-01$/.test(month)) return;
  const supabase = await requireMember();
  const { error } = await supabase.from("balances").delete().eq("month", month);
  if (error) throw new Error(`Could not remove the balances: ${error.message}`);
  revalidatePath("/finances", "layout");
}
