"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { acknowledge } from "../../lib/finances/snapshot";
import { createClient } from "../../lib/supabase/server";

// REQ-59: an admin closes a month that still has a balance, on purpose.
// The database checks the same things (close_month_with_balance) and
// writes the percentages and what was left onto the month.
export async function closeMonthWithBalance(formData: FormData): Promise<void> {
  const monthId = String(formData.get("monthId") ?? "");
  const supabase = await createClient();
  if (!monthId || !(await hasPermission(supabase, "manage_budget"))) {
    redirect("/finances");
  }
  const { error } = await supabase.rpc("close_month_with_balance", { p_month: monthId });
  if (error) throw new Error(`Could not close the month: ${error.message}`);
  revalidatePath("/finances", "layout");
  redirect("/finances");
}

// An admin reopens a closed month (Vin, 2026-10-06), so a mistake found
// afterwards isn't stuck. The database (reopen_month) checks the same
// things; the month then stays open until an admin closes it again.
export async function reopenMonth(formData: FormData): Promise<void> {
  const monthId = String(formData.get("monthId") ?? "");
  const month = String(formData.get("month") ?? "");
  const supabase = await createClient();
  if (!monthId || !(await hasPermission(supabase, "manage_budget"))) {
    redirect("/finances");
  }
  const { error } = await supabase.rpc("reopen_month", { p_month: monthId });
  if (error) throw new Error(`Could not reopen the month: ${error.message}`);
  revalidatePath("/finances", "layout");
  revalidatePath("/");
  redirect(/^\d{4}-\d{2}$/.test(month) ? `/finances?month=${month}` : "/finances");
}

// REQ-93 on Finances home: an item that's only news is cleared from its
// own Acknowledge button, for the person who pressed it: the cash gap and
// the two over-budget items. Any other key is ignored.
export async function acknowledgeItem(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  if (!/^(cash-gap|household-over):\d{4}-\d{2}-01$|^over:\d{4}-\d{2}-01:[0-9a-f-]{36}$/.test(key)) return;
  const supabase = await createClient();
  await acknowledge(supabase, key);
  revalidatePath("/", "layout");
}
