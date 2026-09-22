"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../../lib/auth/permissions";
import { formatPercent, monthLabel, monthStart, parsePercent } from "../../../lib/finances/budget-year";
import { isBillKind } from "../../../lib/finances/bills";
import { isCadence } from "../../../lib/finances/income";
import { parseAmount } from "../../../lib/finances/money";
import { createClient } from "../../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean; message?: string };

async function requireManageBudget() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "manage_budget"))) {
    redirect("/finances");
  }
  return supabase;
}

// The whole Finances module reads this setup, so every save refreshes it.
function refresh() {
  revalidatePath("/finances", "layout");
}

const SHARE_FIELD = "share:";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// REQ-50, #131: a split starts on a month and stays in force until a
// later one starts. Saving a month that already has a split replaces it.
export async function saveSplit(_previous: FormState, formData: FormData): Promise<FormState> {
  const month = String(formData.get("effectiveFrom") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { error: "Choose the month the new split starts in." };
  }
  const effectiveFrom = monthStart(`${month}-01`);

  const shares: { user_id: string; percent: number }[] = [];
  for (const [field, value] of formData.entries()) {
    if (!field.startsWith(SHARE_FIELD)) continue;
    const hundredths = parsePercent(String(value));
    if (hundredths === null) {
      return { error: "Each percentage must be a number from 0 to 100, with at most two decimals." };
    }
    shares.push({ user_id: field.slice(SHARE_FIELD.length), percent: hundredths / 100 });
  }
  if (shares.length === 0) {
    return { error: "Give each person a percentage." };
  }
  const total = shares.reduce((sum, share) => sum + Math.round(share.percent * 100), 0);
  if (total !== 100_00) {
    return { error: `The percentages add up to ${formatPercent(total)}. They must total 100%.` };
  }

  const supabase = await requireManageBudget();
  const { error } = await supabase.rpc("save_split", {
    p_effective_from: effectiveFrom,
    p_note: String(formData.get("note") ?? "").trim(),
    p_shares: shares,
  });
  if (error) return { error: error.message };

  refresh();
  return { saved: true, message: `Split saved, from ${monthLabel(effectiveFrom)} onwards.` };
}

export async function removeSplit(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await requireManageBudget();
  const { error } = await supabase.from("splits").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the split: ${error.message}`);
  refresh();
}

// Adding a source, or changing one: a change ends the old source today
// and starts a new one, so past paydays keep the amount they were paid at.
export async function saveIncomeSource(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const ownerId = String(formData.get("ownerId") ?? "");
  const amount = parseAmount(String(formData.get("netAmount") ?? ""));
  const cadence = String(formData.get("cadence") ?? "");
  const anchorDate = String(formData.get("anchorDate") ?? "");
  if (!name) return { error: "Name the source, so two jobs can be told apart." };
  if (!ownerId) return { error: "Whose pay is it?" };
  if (amount === null) return { error: "Enter the take-home amount of one payment, like 2400.00." };
  if (!isCadence(cadence)) return { error: "Choose how often it's paid." };
  if (!ISO_DAY.test(anchorDate)) return { error: "Enter the date of one real payday." };

  const supabase = await requireManageBudget();
  const { error } = id
    ? await supabase.rpc("change_income_source", {
        p_id: id,
        p_name: name,
        p_owner_id: ownerId,
        p_net_amount: amount,
        p_cadence: cadence,
        p_anchor_date: anchorDate,
      })
    : await supabase.from("income_sources").insert({
        name,
        owner_id: ownerId,
        net_amount: amount,
        cadence,
        anchor_date: anchorDate,
      });
  if (error) return { error: error.message };

  refresh();
  return {
    saved: true,
    message: id ? "Changed, from today onwards. Past paydays keep the old amount." : undefined,
  };
}

// Removing a source ends it rather than deleting it: months already
// worked out from it must not change underneath.
export async function removeIncomeSource(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await requireManageBudget();
  const { error } = await supabase
    .from("income_sources")
    .update({ ended_on: new Date().toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) throw new Error(`Could not remove the income source: ${error.message}`);
  refresh();
}

// Adds a bill, or changes one when the form carries its id.
export async function saveBill(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const dueDay = Number(formData.get("dueDay"));
  if (!name) return { error: "Give the bill a name." };
  if (!isBillKind(kind)) return { error: "Choose rent, card or other." };
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return { error: "The due day is a day of the month, 1 to 31." };
  }

  const supabase = await requireManageBudget();
  const bill = { name, kind, due_day: dueDay };
  const { error } = id
    ? await supabase.from("bills").update(bill).eq("id", id)
    : await supabase.from("bills").insert(bill);
  if (error) return { error: error.message };

  refresh();
  return { saved: true };
}

export async function removeBill(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await requireManageBudget();
  const { error } = await supabase.from("bills").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the bill: ${error.message}`);
  refresh();
}
