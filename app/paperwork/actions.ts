"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasUnderscore } from "../../lib/paperwork/drive";
import { readConnection, renameFoldersInCategory } from "../../lib/paperwork/drive-run";
import { expectedFolderName, labelText, tidyName } from "../../lib/paperwork/paperwork";
import { refresh, requireAdmin, requireMember, rowId, text, UUID } from "./action-helpers";

// newFile: the label of a file the form just made ("F-0005 · Taxes"),
// shown once so it can be printed (REQ-100). driveFolder: for a Google
// Drive file there's no label; this is the folder name to make in Drive
// instead (REQ-152).
export type FormState = { error?: string; saved?: boolean; newFile?: string; driveFolder?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Which location a form chose (REQ-179): one that exists, or (choice
// "new") one made on the spot from the name typed beside it, with the same
// duplicate check as Add.
async function chosenLocation(
  supabase: SupabaseClient,
  formData: FormData,
  allowDrive = false,
): Promise<{ location_id: string; is_drive: boolean } | { error: string }> {
  const choice = text(formData, "locationId");
  if (choice === "new") {
    const name = tidyName(text(formData, "newLocation"));
    if (name === "") return { error: "Name the new location." };
    const { data, error } = await supabase.from("paperwork_locations").insert({ name }).select("id").single();
    if (error || !data) return { error: locationError(error?.message, error?.code, name) };
    return { location_id: (data as { id: string }).id, is_drive: false };
  }
  if (!UUID.test(choice)) return { error: "Choose where the file is kept." };
  // Google Drive is the one built-in location (REQ-179): only a Drive
  // file goes there, and only once a folder is connected (REQ-152).
  const { data: place } = await supabase.from("paperwork_locations").select("built_in").eq("id", choice).maybeSingle();
  const is_drive = (place as { built_in: string | null } | null)?.built_in === "drive";
  if (is_drive && !allowDrive) return { error: "Google Drive is only for Google Drive files." };
  if (is_drive && !(await readConnection(supabase))) {
    return { error: "Google Drive isn't connected yet. An admin connects a folder in Paperwork settings." };
  }
  return { location_id: choice, is_drive };
}

function locationError(message: string | undefined, code: string | undefined, name: string): string {
  return code === "23505" ? `There's already a location called ${name}.` : (message ?? "Could not save the location.");
}

// A new file's fields, from a form that makes one. The form then shows
// the label to print, and leaves you where you were (REQ-100).
type NewFile = { category_id: string; location_id: string; label: string | null; is_drive: boolean };

async function newFileFields(
  supabase: SupabaseClient,
  formData: FormData,
  allowDrive = false,
): Promise<NewFile | { error: string }> {
  const category_id = text(formData, "categoryId");
  if (!UUID.test(category_id)) return { error: "Choose the file's category." };
  const location = await chosenLocation(supabase, formData, allowDrive);
  if ("error" in location) return location;
  return { category_id, ...location, label: text(formData, "label") || null };
}

async function createFile(
  supabase: SupabaseClient,
  fields: NewFile,
): Promise<{ id: string; label: string; driveFolder?: string } | { error: string }> {
  // Only a Drive file says so; a physical file leaves it to the default.
  const row = fields.is_drive ? fields : { category_id: fields.category_id, location_id: fields.location_id, label: fields.label };
  const { data, error } = await supabase.from("paperwork_files").insert(row).select("id, number").single();
  if (error || !data) return { error: error?.message ?? "Could not make the file." };
  const made = data as { id: string; number: number };
  const { data: category } = await supabase
    .from("paperwork_categories")
    .select("name")
    .eq("id", fields.category_id)
    .maybeSingle();
  const named = category as { name: string } | undefined;
  const number = Number(made.number);
  return {
    id: made.id,
    label: labelText({ number }, named),
    ...(fields.is_drive ? { driveFolder: expectedFolderName({ number, label: fields.label }, named) } : {}),
  };
}

// Which file the paperwork goes in: none (Unfiled), one that exists, or a
// new one made from the same form (REQ-97).
async function chosenFile(
  supabase: SupabaseClient,
  formData: FormData,
): Promise<{ fileId: string | null; newFile?: string } | { error: string }> {
  const choice = text(formData, "fileId");
  if (choice === "") return { fileId: null };
  if (choice === "new") {
    const fields = await newFileFields(supabase, formData);
    if ("error" in fields) return fields;
    const made = await createFile(supabase, fields);
    return "error" in made ? made : { fileId: made.id, newFile: made.label };
  }
  if (!UUID.test(choice)) return { error: "Choose a file, or leave it Unfiled." };
  // Physical paperwork goes only into physical files (REQ-152).
  const { data } = await supabase.from("paperwork_files").select("is_drive").eq("id", choice).maybeSingle();
  if ((data as { is_drive: boolean } | null)?.is_drive) return { error: "Paperwork can't go into a Google Drive file." };
  return { fileId: choice };
}

// What a form that may have made a file says back.
const done = (newFile?: string): FormState => (newFile ? { saved: true, newFile } : { saved: true });

function paperFields(formData: FormData) {
  const name = text(formData, "name");
  const owner = text(formData, "ownerId");
  const documentDate = text(formData, "documentDate");
  const keepUntil = text(formData, "keepUntil");
  if (name === "") return { error: "Give the document a name." };
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
// when refiling old papers or adding to the file you're on (REQ-100).
export async function logPaper(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = paperFields(formData);
  if ("error" in fields) return { error: fields.error };
  const file = await chosenFile(supabase, formData);
  if ("error" in file) return { error: file.error };
  const { error } = await supabase.from("paperwork").insert({ ...fields, file_id: file.fileId });
  if (error) return { error: error.message };
  refresh();
  return done(file.newFile);
}

// REQ-97: change any of the paperwork's fields. Moving it to another
// file is its own form (filePaper), so this leaves the file alone.
export async function updatePaper(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const fields = paperFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase.from("paperwork").update(fields).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// REQ-97: filing an unfiled paper is the "done": it leaves the unfiled
// list and Home's count. Moving a filed paper to another file is the
// same thing (REQ-100).
export async function filePaper(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const keepUntil = text(formData, "keepUntil");
  // Moving a filed paper may put it back on the desk (Unfiled); filing
  // an unfiled one needs a file.
  if (text(formData, "fileId") === "" && formData.get("moving") !== "yes") {
    return { error: "Choose a file, or make a new one." };
  }
  if (keepUntil !== "" && !DATE.test(keepUntil)) return { error: "Enter keep-until as a date." };
  const file = await chosenFile(supabase, formData);
  if ("error" in file) return { error: file.error };
  const { error } = await supabase
    .from("paperwork")
    .update({ file_id: file.fileId, keep_until: keepUntil || null })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return done(file.newFile);
}

// REQ-153: archive a single document (filed or unfiled) into a storage
// box's archive, made the first time one goes in. It leaves its file.
export async function archivePaper(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const box = text(formData, "boxId");
  if (!UUID.test(box)) return { error: "Choose the box it goes in." };
  const archive = await archiveOf(supabase, box);
  if ("error" in archive) return archive;
  const { error } = await supabase.from("paperwork").update({ archive_id: archive.id, file_id: null }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/storage", "layout");
  return { saved: true };
}

// A box's archive, made if the box has none. Two people archiving into a
// fresh box at once: the second insert is refused as a duplicate, so it
// reads the one the first made.
async function archiveOf(supabase: SupabaseClient, box: string): Promise<{ id: string } | { error: string }> {
  const find = async () =>
    supabase.from("paperwork_archives").select("id").eq("storage_entry_id", box).maybeSingle();
  const existing = await find();
  if (existing.error) return { error: existing.error.message };
  if (existing.data) return existing.data as { id: string };
  const made = await supabase.from("paperwork_archives").insert({ storage_entry_id: box }).select("id").single();
  if (made.data) return made.data as { id: string };
  if (made.error?.code === "23505") {
    const again = await find();
    if (again.data) return again.data as { id: string };
  }
  return { error: made.error?.message ?? "Could not make the archive." };
}

// REQ-153: an archived document comes back to Unfiled.
export async function bringBackPaper(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) redirect("/paperwork");
  const { error } = await supabase.from("paperwork").update({ archive_id: null }).eq("id", id);
  if (error) throw new Error(`Could not bring the document back: ${error.message}`);
  refresh();
  revalidatePath("/storage", "layout");
  redirect(`/paperwork/items/${id}`);
}

// Back to the file it was in, or the unfiled list.
export async function removePaper(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) redirect("/paperwork");
  const { error } = await supabase.from("paperwork").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the paperwork: ${error.message}`);
  refresh();
  // Stay where you were: the file, the archive, or the unfiled list.
  const fileId = text(formData, "fileId");
  const archiveId = text(formData, "archiveId");
  redirect(
    UUID.test(fileId)
      ? `/paperwork/files/${fileId}`
      : UUID.test(archiveId)
        ? `/paperwork/archives/${archiveId}`
        : "/paperwork/unfiled",
  );
}

// REQ-88: a new file gets the next number, and the form shows its label.
export async function makeFile(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const fields = await newFileFields(supabase, formData, true);
  if ("error" in fields) return { error: fields.error };
  const made = await createFile(supabase, fields);
  if ("error" in made) return { error: made.error };
  refresh();
  return made.driveFolder ? { saved: true, driveFolder: made.driveFolder } : done(made.label);
}

// REQ-88: a file that moved gets its new location; the old one is gone.
export async function updateFile(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  // A Google Drive file's location never changes (REQ-152): only its
  // category and label do, and its folder name follows (see "Fix").
  const { data: current } = await supabase.from("paperwork_files").select("is_drive").eq("id", id).maybeSingle();
  if ((current as { is_drive: boolean } | null)?.is_drive) {
    const category_id = text(formData, "categoryId");
    if (!UUID.test(category_id)) return { error: "Choose the file's category." };
    const { error } = await supabase
      .from("paperwork_files")
      .update({ category_id, label: text(formData, "label") || null })
      .eq("id", id);
    if (error) return { error: error.message };
    refresh();
    return { saved: true };
  }
  const fields = await newFileFields(supabase, formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase
    .from("paperwork_files")
    .update({ category_id: fields.category_id, location_id: fields.location_id, label: fields.label })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// Its paperwork goes back to Unfiled rather than disappearing; its number
// is never handed out again. You stay in its location (or box): the form
// says which, and only a location's or box's own page is accepted.
export async function removeFile(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) redirect("/paperwork");
  const { error } = await supabase.from("paperwork_files").delete().eq("id", id);
  if (error) throw new Error(`Could not remove the file: ${error.message}`);
  refresh();
  const back = text(formData, "returnTo");
  redirect(/^\/paperwork\/(locations|boxes)\/[0-9a-f-]{36}$/i.test(back) ? back : "/paperwork");
}

function categoryFields(formData: FormData) {
  const name = text(formData, "name");
  const years = text(formData, "keepYears");
  if (name === "") return { error: "Give the category a name." };
  // Drive folder names are split at "_" (REQ-152).
  if (hasUnderscore(name)) return { error: "A category name can't contain an underscore (_): Drive folder names use it to separate parts." };
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
  // REQ-152: every linked Drive folder in the category is renamed to match.
  const failed = await renameFoldersInCategory(supabase, { id, ...fields });
  refresh();
  if (failed > 0) {
    return { error: `Saved, but ${failed === 1 ? "1 Drive folder" : `${failed} Drive folders`} couldn't be renamed. Fix them from the files.` };
  }
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

// REQ-98: archive a whole file into a storage box. Only a box is
// offered, and the database refuses anything else.
export async function archiveFile(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const box = text(formData, "boxId");
  if (!UUID.test(box)) return { error: "Choose the box it goes in." };
  const { error } = await supabase
    .from("paperwork_files")
    .update({ status: "archived", storage_entry_id: box })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/storage", "layout");
  return { saved: true };
}

// REQ-98: bring an archived file back to the office, somewhere new.
export async function bringBackFile(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const location = await chosenLocation(supabase, formData);
  if ("error" in location) return { error: location.error };
  const { error } = await supabase
    .from("paperwork_files")
    .update({ status: "active", storage_entry_id: null, location_id: location.location_id })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/storage", "layout");
  return { saved: true };
}

// REQ-179: add a location before any file uses it. A name that matches one
// that exists (ignoring case and extra spaces) is refused.
export async function addLocation(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const name = tidyName(text(formData, "name"));
  if (name === "") return { error: "Give the location a name." };
  const { error } = await supabase.from("paperwork_locations").insert({ name });
  if (error) return { error: locationError(error.message, error.code, name) };
  refresh();
  return { saved: true };
}

// REQ-179: the new name shows everywhere, on every file in it.
export async function renameLocation(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const name = tidyName(text(formData, "name"));
  if (name === "") return { error: "Give the location a name." };
  const { error } = await supabase.from("paperwork_locations").update({ name }).eq("id", id);
  if (error) return { error: locationError(error.message, error.code, name) };
  refresh();
  return { saved: true };
}

// REQ-179: only an empty location goes (no files, active or archived).
export async function deleteLocation(_previous: FormState, formData: FormData): Promise<FormState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to remove." };
  const { count, error: countError } = await supabase
    .from("paperwork_files")
    .select("id", { count: "exact", head: true })
    .eq("location_id", id);
  if (countError) return { error: countError.message };
  if ((count ?? 0) > 0) return { error: "It has files. Move them first." };
  const { error } = await supabase.from("paperwork_locations").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect("/paperwork");
}
