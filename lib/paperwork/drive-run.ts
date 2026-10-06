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
import { expectedFolderName, type Category, type PaperFile } from "./paperwork";

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
// Missing, never dropped; a Drive File follows its folder into or out of
// `Archived`. Returns an error to show, or nothing.
export async function syncDrive(supabase: SupabaseClient): Promise<{ error?: string }> {
  const connection = await readConnection(supabase);
  if (!connection) return {};
  try {
    // If the connected folder itself is gone, nothing below it is: say so
    // rather than marking every document Missing.
    if (!(await getItem(connection.folder_id))) {
      return { error: "HomeBase can't see the connected Google Drive folder. Was it deleted, or is it no longer shared?" };
    }
    if (!(await getItem(connection.archived_folder_id))) {
      return { error: "HomeBase can't see the Archived folder in Google Drive. Was it deleted?" };
    }
    const [files, folders, documents, members] = await Promise.all([
      supabase.from("paperwork_files").select("id, status, drive_folder_id").eq("is_drive", true),
      supabase.from("paperwork_drive_folders").select("drive_id, name, in_archived, ignored, missing"),
      supabase
        .from("paperwork_drive_documents")
        .select("drive_id, name, mime_type, link, drive_owner_email, parent_id, owner_id, owner_set, missing"),
      supabase.from("household_members").select("user_id, google_email"),
    ]);
    for (const result of [files, folders, documents, members]) {
      if (result.error) return { error: result.error.message };
    }
    const driveFiles = (files.data ?? []) as Pick<PaperFile, "id" | "status" | "drive_folder_id">[];
    const linked = new Set(driveFiles.map((file) => file.drive_folder_id).filter((id): id is string => id !== null));

    const top = await listChildren([connection.folder_id, connection.archived_folder_id]);
    const inFiles = await listChildren(foldersToRead(top, connection, linked));
    const plan = planSync(
      connection,
      [...top, ...inFiles],
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

    // A File whose folder is in `Archived` is archived, and back again.
    for (const file of driveFiles) {
      const folder = plan.folders.find((row) => row.drive_id === file.drive_folder_id);
      if (!folder) continue;
      const status = folder.in_archived ? "archived" : "active";
      if (status === file.status) continue;
      const { error } = await supabase.from("paperwork_files").update({ status }).eq("id", file.id);
      if (error) return { error: error.message };
    }
    await supabase.rpc("record_drive_sync");
    return {};
  } catch (error) {
    return { error: driveProblem(error) };
  }
}

// REQ-152: a renamed category renames every linked Drive folder in it (or,
// with `onlyFile`, just that File's, after its category or label changed),
// so the folders keep matching their Files. Returns how many couldn't be
// renamed (they show "Folder name doesn't follow convention" until fixed).
export async function renameFoldersInCategory(
  supabase: SupabaseClient,
  category: Category,
  onlyFile?: string,
): Promise<number> {
  const query = supabase
    .from("paperwork_files")
    .select("id, number, label, drive_folder_id")
    .eq("is_drive", true)
    .eq("category_id", category.id)
    .not("drive_folder_id", "is", null);
  const [files, folders] = await Promise.all([
    onlyFile ? query.eq("id", onlyFile) : query,
    supabase.from("paperwork_drive_folders").select("drive_id, name, missing"),
  ]);
  const known = (folders.data ?? []) as Pick<DriveFolder, "drive_id" | "name" | "missing">[];
  let failed = 0;
  for (const file of (files.data ?? []) as Pick<PaperFile, "number" | "label" | "drive_folder_id">[]) {
    const folder = known.find((row) => row.drive_id === file.drive_folder_id);
    if (!folder || folder.missing) continue;
    const name = expectedFolderName(file, category);
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
