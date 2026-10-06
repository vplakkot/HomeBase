"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { hasPermission } from "../../lib/auth/permissions";
import { folderIdFromLink, getItem, listChildren, moveItem, renameItem, serviceAccountEmail } from "../../lib/paperwork/drive";
import { driveProblem, readConnection, syncDrive } from "../../lib/paperwork/drive-run";
import { expectedFolderName, fileId } from "../../lib/paperwork/paperwork";
import { createClient } from "../../lib/supabase/server";
import { refresh, requireAdmin, requireMember, rowId, text, UUID } from "./action-helpers";

// Google Drive for Paperwork (REQ-152, REQ-153). Every action that changes
// Drive does it first and the database after, so if Drive says no nothing
// here has changed.

export type DriveState = { error?: string; saved?: boolean };

const NOT_CONNECTED = "Google Drive isn't connected yet. An admin connects a folder in Paperwork settings.";

// REQ-152 "Connection": the admin pastes the folder's link; the app checks
// it can read it and that it has an `Archived` sub-folder, and says which
// of the two fails.
export async function connectDrive(_previous: DriveState, formData: FormData): Promise<DriveState> {
  const supabase = await requireAdmin();
  const email = serviceAccountEmail();
  if (!email) return { error: "The Google Drive key isn't set up on the server yet." };
  const id = folderIdFromLink(text(formData, "link"));
  if (!id) return { error: "That doesn't look like a Google Drive folder link." };
  try {
    const folder = await getItem(id);
    if (!folder?.isFolder) {
      return { error: `HomeBase can't read that folder. Share it with ${email} as an Editor, then try again.` };
    }
    const inside = await listChildren([id]);
    const archived = inside.find((item) => item.isFolder && item.name === "Archived");
    if (!archived) return { error: "HomeBase can read the folder, but there's no sub-folder called Archived in it. Make one, then try again." };

    const current = await readConnection(supabase);
    if (current && current.folder_id !== id) {
      const { count } = await supabase.from("paperwork_files").select("id", { count: "exact", head: true }).eq("is_drive", true);
      if ((count ?? 0) > 0) return { error: "Google Drive files are already linked to the connected folder, so it can't be swapped." };
    }
    const { error } = await supabase
      .from("paperwork_drive")
      .upsert({ id: true, folder_id: id, archived_folder_id: archived.id }, { onConflict: "id" });
    if (error) return { error: error.message };
  } catch (error) {
    return { error: driveProblem(error) };
  }
  const synced = await syncDrive(supabase);
  refresh();
  return synced.error ? { error: synced.error } : { saved: true };
}

// REQ-152 "Sync": opening Paperwork or tapping Refresh re-reads the folder.
// Any member may; it changes only HomeBase's copy of what Drive holds.
export async function refreshDrive(): Promise<DriveState> {
  const supabase = await createClient();
  if (!(await hasPermission(supabase, "use_modules"))) return { error: "Sign in again." };
  const result = await syncDrive(supabase);
  if (result.error) return result;
  revalidatePath("/paperwork", "layout");
  return { saved: true };
}

type DriveFileRow = { id: string; number: number; label: string | null; category_id: string; status: string; drive_folder_id: string | null };

async function driveFile(supabase: SupabaseClient, id: string): Promise<DriveFileRow | null> {
  const { data } = await supabase
    .from("paperwork_files")
    .select("id, number, label, category_id, status, drive_folder_id")
    .eq("id", id)
    .eq("is_drive", true)
    .maybeSingle();
  return (data ?? null) as DriveFileRow | null;
}

// REQ-152 "Creating a Drive File": after the folder is made in Drive by
// hand, the app finds the sub-folder whose name starts with the File's ID
// and links to it by its Drive ID, for good.
export async function linkDriveFolder(_previous: DriveState, formData: FormData): Promise<DriveState> {
  const supabase = await requireMember();
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const file = await driveFile(supabase, id);
  if (!file) return { error: "That isn't a Google Drive file." };
  if (file.drive_folder_id) return { saved: true };
  const connection = await readConnection(supabase);
  if (!connection) return { error: NOT_CONNECTED };
  try {
    const prefix = `${fileId(file)}_`;
    const found = (await listChildren([connection.folder_id])).find(
      (item) => item.isFolder && item.id !== connection.archived_folder_id && item.name.startsWith(prefix),
    );
    if (!found) return { error: `No folder starting with ${prefix} was found yet. Make it in the connected Drive folder, then try again.` };
    const { error } = await supabase.from("paperwork_files").update({ drive_folder_id: found.id }).eq("id", id);
    if (error) return { error: error.code === "23505" ? "That folder is already linked to another file." : error.message };
  } catch (error) {
    return { error: driveProblem(error) };
  }
  await syncDrive(supabase);
  refresh();
  return { saved: true };
}

// REQ-152 "Folder name checks": a sub-folder nobody has linked yet goes to
// a File that's waiting for its folder.
export async function linkUnlinkedFolder(_previous: DriveState, formData: FormData): Promise<DriveState> {
  const supabase = await requireAdmin();
  const folder = text(formData, "folderId");
  const file = text(formData, "fileId");
  if (!folder || !UUID.test(file)) return { error: "Choose a file waiting for its folder." };
  const row = await driveFile(supabase, file);
  if (!row || row.drive_folder_id) return { error: "That file isn't waiting for a folder." };
  const { error } = await supabase.from("paperwork_files").update({ drive_folder_id: folder }).eq("id", file);
  if (error) return { error: error.code === "23505" ? "That folder is already linked to another file." : error.message };
  await syncDrive(supabase);
  refresh();
  return { saved: true };
}

export async function ignoreFolder(formData: FormData): Promise<void> {
  const supabase = await requireAdmin();
  const folder = text(formData, "folderId");
  if (!folder) return;
  const { error } = await supabase.from("paperwork_drive_folders").update({ ignored: true }).eq("drive_id", folder);
  if (error) throw new Error(`Could not ignore the folder: ${error.message}`);
  refresh();
}

// REQ-152: the app is the source of truth for a folder's name, so a folder
// that doesn't match gets renamed to the expected name.
export async function fixFolderName(formData: FormData): Promise<void> {
  const supabase = await requireAdmin();
  const id = rowId(formData);
  if (!id) return;
  const file = await driveFile(supabase, id);
  if (!file?.drive_folder_id) return;
  const { data: category } = await supabase.from("paperwork_categories").select("name").eq("id", file.category_id).maybeSingle();
  const name = expectedFolderName(file, category as { name: string } | undefined);
  try {
    await renameItem(file.drive_folder_id, name);
  } catch (error) {
    throw new Error(driveProblem(error));
  }
  await supabase.from("paperwork_drive_folders").update({ name }).eq("drive_id", file.drive_folder_id);
  refresh();
}

type DocumentRow = { drive_id: string; parent_id: string; name: string };

async function driveDocument(supabase: SupabaseClient, drive: string): Promise<DocumentRow | null> {
  const { data } = await supabase.from("paperwork_drive_documents").select("drive_id, parent_id, name").eq("drive_id", drive).maybeSingle();
  return (data ?? null) as DocumentRow | null;
}

// An owner from a form: a household member, or Joint.
function chosenOwner(formData: FormData): { owner_id: string | null } | { error: string } {
  const owner = text(formData, "ownerId");
  if (owner === "joint") return { owner_id: null };
  return UUID.test(owner) ? { owner_id: owner } : { error: "Say whose it is, or Joint." };
}

// REQ-152 "Documents": filing a Drive document moves it into the File's
// folder in Drive, and the owner must be confirmed (the form pre-fills it
// from who owns the document in Drive). Drive documents go only into
// Drive files, and the folder must be a live Active one.
export async function fileDriveDocument(_previous: DriveState, formData: FormData): Promise<DriveState> {
  const supabase = await requireMember();
  const drive = text(formData, "documentId");
  const fileChoice = text(formData, "fileId");
  if (!drive) return { error: "Nothing to change." };
  if (!UUID.test(fileChoice)) return { error: "Choose a Google Drive file." };
  const owner = chosenOwner(formData);
  if ("error" in owner) return owner;
  const [document, file] = await Promise.all([driveDocument(supabase, drive), driveFile(supabase, fileChoice)]);
  if (!document) return { error: "That document isn't in Google Drive any more. Refresh." };
  if (!file?.drive_folder_id) return { error: "That file has no Drive folder yet." };
  if (file.status !== "active") return { error: "That file is archived. Bring it back first." };
  if (file.drive_folder_id !== document.parent_id) {
    try {
      await moveItem(drive, document.parent_id, file.drive_folder_id);
    } catch (error) {
      return { error: driveProblem(error) };
    }
  }
  const { error } = await supabase
    .from("paperwork_drive_documents")
    .update({ parent_id: file.drive_folder_id, owner_id: owner.owner_id, owner_set: true })
    .eq("drive_id", drive);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// REQ-152: a document that reached a File's folder without being filed
// here shows "Owner not set" until someone sets it.
export async function setDocumentOwner(_previous: DriveState, formData: FormData): Promise<DriveState> {
  const supabase = await requireMember();
  const drive = text(formData, "documentId");
  const owner = chosenOwner(formData);
  if (!drive) return { error: "Nothing to change." };
  if ("error" in owner) return owner;
  const { error } = await supabase
    .from("paperwork_drive_documents")
    .update({ owner_id: owner.owner_id, owner_set: true })
    .eq("drive_id", drive);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

// REQ-153: a Drive document (filed or not) goes loose into `Archived`; the
// owner it has stays.
export async function archiveDriveDocument(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const drive = text(formData, "documentId");
  const connection = await readConnection(supabase);
  const document = drive ? await driveDocument(supabase, drive) : null;
  if (!connection || !document) return;
  if (document.parent_id !== connection.archived_folder_id) {
    try {
      await moveItem(drive, document.parent_id, connection.archived_folder_id);
    } catch (error) {
      throw new Error(driveProblem(error));
    }
    await supabase.from("paperwork_drive_documents").update({ parent_id: connection.archived_folder_id }).eq("drive_id", drive);
  }
  refresh();
}

// REQ-153: an archived Drive document returns to Unfiled, the top level of
// the connected folder.
export async function bringBackDriveDocument(formData: FormData): Promise<void> {
  const supabase = await requireMember();
  const drive = text(formData, "documentId");
  const connection = await readConnection(supabase);
  const document = drive ? await driveDocument(supabase, drive) : null;
  if (!connection || !document) return;
  if (document.parent_id !== connection.folder_id) {
    try {
      await moveItem(drive, document.parent_id, connection.folder_id);
    } catch (error) {
      throw new Error(driveProblem(error));
    }
    await supabase.from("paperwork_drive_documents").update({ parent_id: connection.folder_id }).eq("drive_id", drive);
  }
  refresh();
}

// REQ-152 "Sync": the admin removes the record of a document Drive no
// longer has.
export async function removeMissingDocument(formData: FormData): Promise<void> {
  const supabase = await requireAdmin();
  const drive = text(formData, "documentId");
  if (!drive) return;
  const { error } = await supabase.from("paperwork_drive_documents").delete().eq("drive_id", drive).eq("missing", true);
  if (error) throw new Error(`Could not remove the record: ${error.message}`);
  refresh();
}

// REQ-152 "Archive": archiving a Drive File moves its folder into
// `Archived`; bringing it back moves it to the top level.
async function moveFileFolder(supabase: SupabaseClient, formData: FormData, toArchive: boolean): Promise<DriveState> {
  const id = rowId(formData);
  if (!id) return { error: "Nothing to change." };
  const file = await driveFile(supabase, id);
  const connection = await readConnection(supabase);
  if (!file?.drive_folder_id) return { error: "That file has no Drive folder to move yet." };
  if (!connection) return { error: NOT_CONNECTED };
  const [from, to] = toArchive
    ? [connection.folder_id, connection.archived_folder_id]
    : [connection.archived_folder_id, connection.folder_id];
  try {
    await moveItem(file.drive_folder_id, from, to);
  } catch (error) {
    return { error: driveProblem(error) };
  }
  await supabase.from("paperwork_drive_folders").update({ in_archived: toArchive }).eq("drive_id", file.drive_folder_id);
  const { error } = await supabase.from("paperwork_files").update({ status: toArchive ? "archived" : "active" }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { saved: true };
}

export async function archiveDriveFile(_previous: DriveState, formData: FormData): Promise<DriveState> {
  return moveFileFolder(await requireMember(), formData, true);
}

export async function bringBackDriveFile(_previous: DriveState, formData: FormData): Promise<DriveState> {
  return moveFileFolder(await requireMember(), formData, false);
}
