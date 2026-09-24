"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

const UUID = /^[0-9a-f-]{36}$/i;

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/storage");
  return supabase;
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

function rowId(formData: FormData): string | null {
  const id = text(formData, "id");
  return UUID.test(id) ? id : null;
}

function refresh() {
  revalidatePath("/storage", "layout");
  // Paperwork shows which box an archived file is in.
  revalidatePath("/paperwork", "layout");
  // Home's count.
  revalidatePath("/");
}

// REQ-87: a name, box or not, and for a box its contents, one item per
// line. A loose item keeps no contents, so switching a box to not-a-box
// drops them.
function entryFields(formData: FormData) {
  const name = text(formData, "name");
  if (name === "") return { error: "Give the entry a name." };
  const is_box = formData.get("isBox") === "yes";
  const contents = is_box
    ? String(formData.get("contents") ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join("\n") || null
    : null;
  return { name, is_box, contents, note: text(formData, "note") || null };
}

// How many archived paperwork files a box holds (REQ-87, REQ-98).
async function filesInside(supabase: SupabaseClient, id: string): Promise<number | { error: string }> {
  const { count, error } = await supabase
    .from("paperwork_files")
    .select("id", { count: "exact", head: true })
    .eq("storage_entry_id", id);
  if (error) return { error: error.message };
  return count ?? 0;
}

const moveFirst = (count: number) =>
  `It holds ${count === 1 ? "1 archived paperwork file" : `${count} archived paperwork files`}. Bring ${count === 1 ? "it" : "them"} back or archive ${count === 1 ? "it" : "them"} to another box first.`;

// REQ-87: a new entry gets the next ID, and its page shows it for the
// label printer.
export async function addEntry(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = entryFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { data, error } = await supabase.from("storage_entries").insert(fields).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not add the entry." };
  refresh();
  redirect(`/storage/entries/${(data as { id: string }).id}?new=1`);
}

// REQ-87: change any field, box or not included; the ID stays. A box
// holding archived files stays a box until they move.
export async function updateEntry(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = entryFields(formData);
  if ("error" in fields) return { error: fields.error };
  if (!fields.is_box) {
    const count = await filesInside(supabase, id);
    if (typeof count !== "number") return count;
    if (count > 0) return { error: moveFirst(count) };
  }
  const { error } = await supabase.from("storage_entries").update(fields).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// REQ-87: removing asks first (the form does), and a box holding archived
// files can't go until they move. Its ID is never handed out again.
export async function removeEntry(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to remove." };
  const count = await filesInside(supabase, id);
  if (typeof count !== "number") return count;
  if (count > 0) return { error: moveFirst(count) };
  const { error } = await supabase.from("storage_entries").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect("/storage");
}
