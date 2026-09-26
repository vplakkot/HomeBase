"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { drinkFields } from "../../lib/drinks/drinks";
import { createClient } from "../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

const UUID = /^[0-9a-f-]{36}$/i;

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/drinks");
  return supabase;
}

function rowId(formData: FormData, name = "id"): string | null {
  const id = String(formData.get(name) ?? "").trim();
  return UUID.test(id) ? id : null;
}

function refresh() {
  revalidatePath("/drinks", "layout");
  // Home's count.
  revalidatePath("/");
}

// REQ-37: only the name is required. A new drink opens on its own page,
// where it can be rated straight away.
export async function addDrink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = drinkFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { data, error } = await supabase.from("drinks").insert(fields).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not add the drink." };
  refresh();
  redirect(`/drinks/${(data as { id: string }).id}`);
}

export async function updateDrink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = drinkFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase.from("drinks").update(fields).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect(`/drinks/${id}`);
}

// Removing asks first (the form does); its ratings go with it.
export async function removeDrink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to remove." };
  const { error } = await supabase.from("drinks").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect("/drinks");
}

// REQ-29: whole stars 1 to 5 and an optional one-line comment, for the
// person signed in only. Rating again replaces the rating, never adds a
// second one: the database keeps one row per person per drink, and this
// writes over it.
export async function rateDrink(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const drinkId = rowId(formData, "drinkId");
  if (!drinkId) return { error: "Nothing to rate." };
  const stars = Number(formData.get("stars"));
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { error: "Choose 1 to 5 stars." };
  const comment = String(formData.get("comment") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (comment.length > 200) return { error: "Keep the comment to one short line (200 characters)." };
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");
  const { error } = await supabase
    .from("drink_ratings")
    .upsert({ drink_id: drinkId, user_id: userId, stars, comment: comment || null }, { onConflict: "drink_id,user_id" });
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// A rating given by mistake can be taken back (never locked). Only your
// own: the database refuses anyone else's.
export async function clearRating(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const drinkId = rowId(formData, "drinkId");
  if (!drinkId) return { error: "Nothing to clear." };
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");
  const { error } = await supabase.from("drink_ratings").delete().eq("drink_id", drinkId).eq("user_id", userId);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}
