"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";

export type FormState = { error?: string; saved?: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

async function requireMember() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) redirect("/paperwork");
  return supabase;
}

// REQ-88: only the admin changes categories.
async function requireAdmin() {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "manage_paperwork"))) redirect("/paperwork");
  return supabase;
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

// The row a form is about. A missing or garbled id would change nothing
// and still say "saved", so it's refused instead.
function rowId(formData: FormData): string | null {
  const id = text(formData, "id");
  return UUID.test(id) ? id : null;
}

function refresh() {
  revalidatePath("/paperwork", "layout");
  // Home's unfiled count.
  revalidatePath("/");
}

// A new file's fields, from a form that makes one. The printed label is
// shown on the file's page, which the caller goes to next.
type NewFile = { category_id: string; location: string; label: string | null };

function newFileFields(formData: FormData): NewFile | { error: string } {
  const category_id = text(formData, "categoryId");
  const location = text(formData, "location");
  if (!UUID.test(category_id)) return { error: "Choose the file's category." };
  if (location === "") return { error: "Say where the file is kept." };
  return { category_id, location, label: text(formData, "label") || null };
}

async function createFile(supabase: SupabaseClient, fields: NewFile): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase.from("paperwork_files").insert(fields).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not make the file." };
  return { id: (data as { id: string }).id };
}

// Which file the paperwork goes in: none (Unfiled), one that exists, or a
// new one made from the same form (REQ-97).
async function chosenFile(
  supabase: SupabaseClient,
  formData: FormData,
): Promise<{ fileId: string | null; created: boolean } | { error: string }> {
  const choice = text(formData, "fileId");
  if (choice === "") return { fileId: null, created: false };
  if (choice === "new") {
    const fields = newFileFields(formData);
    if ("error" in fields) return fields;
    const made = await createFile(supabase, fields);
    return "error" in made ? made : { fileId: made.id, created: true };
  }
  if (!UUID.test(choice)) return { error: "Choose a file, or leave it Unfiled." };
  return { fileId: choice, created: false };
}

function paperFields(formData: FormData) {
  const name = text(formData, "name");
  const owner = text(formData, "ownerId");
  const documentDate = text(formData, "documentDate");
  const keepUntil = text(formData, "keepUntil");
  if (name === "") return { error: "Give the paperwork a name." };
  if (owner !== "joint" && !UUID.test(owner)) return { error: "Say whose it is, or Joint." };
  if (documentDate !== "" && !DATE.test(documentDate)) return { error: "Enter the document date as a date." };
  if (keepUntil !== "" && !DATE.test(keepUntil)) return { error: "Enter keep-until as a date." };
  return {
    name,
    owner_id: owner === "joint" ? null : owner,
    document_date: documentDate || null,
    notes: text(formData, "notes") || null,
    keep_until: keepUntil || null,
  };
}

// REQ-97: log paperwork as it arrives, Unfiled, or straight into a file
// when refiling old papers. A new file made on the way opens its page, so
// its label can be printed.
export async function logPaper(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = paperFields(formData);
  if ("error" in fields) return { error: fields.error };
  const file = await chosenFile(supabase, formData);
  if ("error" in file) return { error: file.error };
  const { error } = await supabase.from("paperwork").insert({ ...fields, file_id: file.fileId });
  if (error) return { error: error.message };
  refresh();
  if (file.created) redirect(`/paperwork/files/${file.fileId}?new=1`);
  return { saved: true };
}

// REQ-97: change any of the paperwork's fields, its file included.
export async function updatePaper(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = paperFields(formData);
  if ("error" in fields) return { error: fields.error };
  const file = await chosenFile(supabase, formData);
  if ("error" in file) return { error: file.error };
  const { error } = await supabase.from("paperwork").update({ ...fields, file_id: file.fileId }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  if (file.created) redirect(`/paperwork/files/${file.fileId}?new=1`);
  return { saved: true };
}

// REQ-97: filing an unfiled paper is the "done": it leaves the unfiled
// list and Home's count.
export async function filePaper(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const keepUntil = text(formData, "keepUntil");
  if (text(formData, "fileId") === "") return { error: "Choose a file, or make a new one." };
  if (keepUntil !== "" && !DATE.test(keepUntil)) return { error: "Enter keep-until as a date." };
  const file = await chosenFile(supabase, formData);
  if ("error" in file) return { error: file.error };
  const { error } = await supabase
    .from("paperwork")
    .update({ file_id: file.fileId, keep_until: keepUntil || null })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh();
  if (file.created) redirect(`/paperwork/files/${file.fileId}?new=1`);
  return { saved: true };
}

export async function removePaper(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) redirect("/paperwork");
  const { error } = await supabase.from("paperwork").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the paperwork: ${error.message}`);
  refresh();
  redirect("/paperwork");
}

// REQ-88: a new file gets the next number, and its page shows the label.
export async function makeFile(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = newFileFields(formData);
  if ("error" in fields) return { error: fields.error };
  const made = await createFile(supabase, fields);
  if ("error" in made) return { error: made.error };
  refresh();
  redirect(`/paperwork/files/${made.id}?new=1`);
}

// REQ-88: a file that moved gets its new location; the old one is gone.
export async function updateFile(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = newFileFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase.from("paperwork_files").update(fields).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// Its paperwork goes back to Unfiled rather than disappearing; its number
// is never handed out again.
export async function removeFile(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) redirect("/paperwork");
  const { error } = await supabase.from("paperwork_files").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the file: ${error.message}`);
  refresh();
  redirect("/paperwork");
}

function categoryFields(formData: FormData) {
  const name = text(formData, "name");
  const years = text(formData, "keepYears");
  if (name === "") return { error: "Give the category a name." };
  if (years !== "" && !/^\d+$/.test(years)) return { error: "Keep for a whole number of years, or leave it blank." };
  const keep_years = years === "" ? null : Number(years);
  if (keep_years !== null && (keep_years < 1 || keep_years > 100)) return { error: "Keep for 1 to 100 years." };
  return { name, keep_years };
}

function categoryError(message: string, code: string | undefined, name: string): string {
  return code === "23505" ? `There's already a category called ${name}.` : message;
}

export async function addCategory(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireAdmin();
  const fields = categoryFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase.from("paperwork_categories").insert(fields);
  if (error) return { error: categoryError(error.message, error.code, fields.name) };
  refresh();
  return { saved: true };
}

export async function updateCategory(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireAdmin();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = categoryFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase.from("paperwork_categories").update(fields).eq("id", id);
  if (error) return { error: categoryError(error.message, error.code, fields.name) };
  refresh();
  return { saved: true };
}

// REQ-88: a category files still use can't just go. The form asks where
// to move them; with somewhere chosen, they move and the category goes.
export async function removeCategory(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireAdmin();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const moveTo = text(formData, "moveTo");
  const { count, error: countError } = await supabase
    .from("paperwork_files")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if (countError) return { error: countError.message };
  if ((count ?? 0) > 0) {
    if (!UUID.test(moveTo) || moveTo === id) {
      return { error: `${count === 1 ? "1 file uses" : `${count} files use`} it. Choose a category to move them to first.` };
    }
    const { error } = await supabase.from("paperwork_files").update({ category_id: moveTo }).eq("category_id", id);
    if (error) return { error: error.message };
  }
  const { error } = await supabase.from("paperwork_categories").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}
