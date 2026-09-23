"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../../lib/auth/permissions";
import { parseAmount } from "../../../lib/finances/money";
import { createClient } from "../../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

// A blank box means nothing was put away; otherwise a dollar amount.
function savedAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "" || /^\$?0+(\.0{1,2})?$/.test(trimmed)) return 0;
  return parseAmount(trimmed);
}

// REQ-66: what each person actually put into joint savings and saved on
// their own in a month. Any member records it for either person, and it
// can be corrected later, even once the month is closed.
export async function recordSavings(_previous: FormState, formData: FormData): Promise<FormState> {
  const monthId = String(formData.get("monthId") ?? "");
  const people = formData.getAll("userId").map(String);
  if (!monthId || people.length === 0) return { error: "Nothing to record." };

  const rows = [];
  for (const userId of people) {
    const toJoint = savedAmount(String(formData.get(`joint-${userId}`) ?? ""));
    const own = savedAmount(String(formData.get(`own-${userId}`) ?? ""));
    if (toJoint === null || own === null) return { error: "Enter amounts like 50 or 50.00, or leave a box blank." };
    rows.push({ month_id: monthId, user_id: userId, to_joint: toJoint, own, updated_at: new Date().toISOString() });
  }

  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/finances");
  const { error } = await supabase.from("month_savings").upsert(rows, { onConflict: "month_id,user_id" });
  if (error) return { error: error.message };
  revalidatePath("/finances", "layout");
  return { saved: true };
}
