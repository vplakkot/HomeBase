"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../../lib/auth/permissions";
import { budgetYearLabel, formatPercent, parsePercent } from "../../../lib/finances/budget-year";
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

export async function saveBudgetYear(_previous: FormState, formData: FormData): Promise<FormState> {
  const startYear = Number(formData.get("startYear"));
  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2999) {
    return { error: "Enter the year the budget year's April falls in, like 2026." };
  }

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
  const { error } = await supabase.rpc("save_budget_year", {
    p_start_year: startYear,
    p_note: String(formData.get("note") ?? "").trim(),
    p_shares: shares,
  });
  if (error) return { error: error.message };

  refresh();
  return { saved: true, message: `Split saved for ${budgetYearLabel(startYear)}.` };
}

export async function addIncomeSource(_previous: FormState, formData: FormData): Promise<FormState> {
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
  const { error } = await supabase.from("income_sources").insert({
    name,
    owner_id: ownerId,
    net_amount: amount,
    cadence,
    anchor_date: anchorDate,
  });
  if (error) return { error: error.message };

  refresh();
  return { saved: true };
}

export async function removeIncomeSource(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await requireManageBudget();
  const { error } = await supabase.from("income_sources").delete().eq("id", id);
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
