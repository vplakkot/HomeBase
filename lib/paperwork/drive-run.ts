import type { SupabaseClient } from "@supabase/supabase-js";
import { DriveError, getItem, listChildren, renameItem } from "./drive";
import {
  foldersToRead,
  planSync,
  type DriveConnection,
  type DriveDocument,
  type DriveFolder,
  type SyncMember,
} from "./drive-sync";
import { expectedFolderName, type Category, type PaperFileFolder } from "./paperwork";

// The parts of REQ-152 that talk to both Drive and the database.

export async function readConnection(supabase: SupabaseClient): Promise<DriveConnection | null> {
  const { data } = await supabase.from("paperwork_drive").select("folder_id, archived_folder_id, synced_at").maybeSingle();
  return (data ?? null) as DriveConnection | null;
}

// The words to show for something that went wrong talking to Drive.
export const driveProblem = (error: unknown): string =>
  error instanceof DriveError ? error.message : "Google Drive couldn't be reached. Try again in a moment.";

// Re-reads the connected folder and brings HomeBase's copy up to date
// (REQ-152 "Sync"). A folder or document Drive no longer has is marked
// Missing, never dropped; a Drive File Folder follows its folder into or out of
// `Archived`. Returns an error to show, or nothing.
export async function syncDrive(supabase: SupabaseClient): Promise<{ error?: string }> {
  const connection = await readConnection(supabase);
  if (!connection) return {};
  try {
    // If the connected folder itself is gone, nothing below it is: say so
    // rather than marking every document Missing.
    if (!(await getItem(connection.folder_id))) {
      return { error: "HomeBase can't see the connected Digital Folder. Was it deleted, or is it no longer shared?" };
    }
    if (!(await getItem(connection.archived_folder_id))) {
      return { error: "HomeBase can't see the Archived Digital Folder in Google Drive. Was it deleted?" };
    }
    const [fileFolders, folders, documents, members] = await Promise.all([
      supabase.from("paperwork_file_folders").select("id, status, drive_folder_id").eq("is_drive", true),
      supabase.from("paperwork_drive_folders").select("drive_id, name, in_archived, ignored, missing"),
      supabase
        .from("paperwork_drive_documents")
        .select("drive_id, name, mime_type, link, drive_owner_email, parent_id, owner_id, owner_set, missing"),
      supabase.rpc("paperwork_member_accounts"),
    ]);
    for (const result of [fileFolders, folders, documents, members]) {
      if (result.error) return { error: result.error.message };
    }
    const driveFileFolders = (fileFolders.data ?? []) as Pick<PaperFileFolder, "id" | "status" | "drive_folder_id">[];
    const linked = new Set(driveFileFolders.map((fileFolder) => fileFolder.drive_folder_id).filter((id): id is string => id !== null));

    const top = await listChildren([connection.folder_id, connection.archived_folder_id]);
    const inFileFolders = await listChildren(foldersToRead(top, connection, linked));
    const plan = planSync(
      connection,
      [...top, ...inFileFolders],
      (folders.data ?? []) as DriveFolder[],
      (documents.data ?? []) as DriveDocument[],
      (members.data ?? []) as SyncMember[],
    );

    if (plan.folders.length > 0) {
      const { error } = await supabase.from("paperwork_drive_folders").upsert(plan.folders, { onConflict: "drive_id" });
      if (error) return { error: error.message };
    }
    if (plan.goneFolders.length > 0) {
      const { error } = await supabase.from("paperwork_drive_folders").update({ missing: true }).in("drive_id", plan.goneFolders);
      if (error) return { error: error.message };
    }
    if (plan.documents.length > 0) {
      const { error } = await supabase.from("paperwork_drive_documents").upsert(plan.documents, { onConflict: "drive_id" });
      if (error) return { error: error.message };
    }
    if (plan.goneDocuments.length > 0) {
      const { error } = await supabase.from("paperwork_drive_documents").update({ missing: true }).in("drive_id", plan.goneDocuments);
      if (error) return { error: error.message };
    }

    // A File Folder whose folder is in `Archived` is archived, and back again.
    for (const fileFolder of driveFileFolders) {
      const folder = plan.folders.find((row) => row.drive_id === fileFolder.drive_folder_id);
      if (!folder) continue;
      const status = folder.in_archived ? "archived" : "active";
      if (status === fileFolder.status) continue;
      const { error } = await supabase.from("paperwork_file_folders").update({ status }).eq("id", fileFolder.id);
      if (error) return { error: error.message };
    }
    await supabase.rpc("record_drive_sync");
    return {};
  } catch (error) {
    return { error: driveProblem(error) };
  }
}

// REQ-152: a renamed category renames every linked Drive folder in it (or,
// with `onlyFile`, just that File Folder's, after its category or label changed),
// so the folders keep matching their File Folders. Returns how many couldn't be
// renamed (they show "Folder name doesn't follow convention" until fixed).
export async function renameFoldersInCategory(
  supabase: SupabaseClient,
  category: Category,
  onlyFileFolder?: string,
): Promise<number> {
  const query = supabase
    .from("paperwork_file_folders")
    .select("id, number, label, drive_folder_id")
    .eq("is_drive", true)
    .eq("category_id", category.id)
    .not("drive_folder_id", "is", null);
  const [fileFolders, folders] = await Promise.all([
    onlyFileFolder ? query.eq("id", onlyFileFolder) : query,
    supabase.from("paperwork_drive_folders").select("drive_id, name, missing"),
  ]);
  const known = (folders.data ?? []) as Pick<DriveFolder, "drive_id" | "name" | "missing">[];
  let failed = 0;
  for (const fileFolder of (fileFolders.data ?? []) as Pick<PaperFileFolder, "number" | "label" | "drive_folder_id">[]) {
    const folder = known.find((row) => row.drive_id === fileFolder.drive_folder_id);
    if (!folder || folder.missing) continue;
    const name = expectedFolderName(fileFolder, category);
    if (folder.name === name) continue;
    try {
      await renameItem(folder.drive_id, name);
      const { error } = await supabase.from("paperwork_drive_folders").update({ name }).eq("drive_id", folder.drive_id);
      if (error) failed += 1;
    } catch {
      failed += 1;
    }
  }
  return failed;
}
