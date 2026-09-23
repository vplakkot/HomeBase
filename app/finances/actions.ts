"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
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
}
