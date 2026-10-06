import type { DriveItem } from "./drive";

// REQ-152's sync: what HomeBase remembers of the connected Drive folder,
// and how a fresh look at Drive changes it. The work with Drive and the
// database is in the actions; this is the part that decides, so it can be
// tested without either.

// The connected folder, and the `Archived` sub-folder found inside it.
export type DriveConnection = { folder_id: string; archived_folder_id: string; synced_at: string | null };

// A sub-folder of the connected folder, or of `Archived`.
export type DriveFolder = {
  drive_id: string;
  name: string;
  in_archived: boolean;
  // The admin chose to ignore it while it isn't linked to a File.
  ignored: boolean;
  // Deleted or trashed in Drive since it was last seen.
  missing: boolean;
};

export type DriveDocument = {
  drive_id: string;
  name: string;
  mime_type: string | null;
  link: string | null;
  drive_owner_email: string | null;
  // The folder it's directly in: a File's, `Archived`, or the top one.
  parent_id: string;
  // null is Joint; only meaningful once owner_set.
  owner_id: string | null;
  owner_set: boolean;
  missing: boolean;
};

export type SyncMember = { user_id: string; google_email: string | null };

export type SyncPlan = {
  folders: DriveFolder[];
  goneFolders: string[];
  documents: DriveDocument[];
  goneDocuments: string[];
};

// Which folders to look inside for documents: only those linked to a File
// (a folder nobody has linked is not read).
export function foldersToRead(items: readonly DriveItem[], connection: DriveConnection, linked: ReadonlySet<string>): string[] {
  return items
    .filter((item) => item.isFolder && item.id !== connection.archived_folder_id && linked.has(item.id))
    .map((item) => item.id);
}

// `items` is everything directly inside the connected folder, inside
// `Archived`, and inside each linked File's folder.
export function planSync(
  connection: DriveConnection,
  items: readonly DriveItem[],
  knownFolders: readonly DriveFolder[],
  knownDocuments: readonly DriveDocument[],
  members: readonly SyncMember[],
): SyncPlan {
  const { folder_id: top, archived_folder_id: archived } = connection;
  const inside = (item: DriveItem, parent: string) => item.parents.includes(parent);

  const folders: DriveFolder[] = [];
  for (const item of items) {
    if (!item.isFolder || item.id === archived) continue;
    const inTop = inside(item, top);
    const inArchived = inside(item, archived);
    if (!inTop && !inArchived) continue;
    const known = knownFolders.find((row) => row.drive_id === item.id);
    folders.push({ drive_id: item.id, name: item.name, in_archived: inArchived && !inTop, ignored: known?.ignored ?? false, missing: false });
  }

  // Documents sit directly in the top folder, `Archived`, or a File's
  // folder; anything deeper isn't looked at (REQ-152).
  const homes = new Set([top, archived, ...folders.map((folder) => folder.drive_id)]);
  const documents: DriveDocument[] = [];
  for (const item of items) {
    if (item.isFolder) continue;
    const parent = item.parents.find((id) => homes.has(id));
    if (!parent) continue;
    const known = knownDocuments.find((row) => row.drive_id === item.id);
    let { owner_id, owner_set } = known ?? { owner_id: null, owner_set: false };
    // In a File (or Archived) with no owner decided: the household member
    // whose Google account owns it in Drive. Loose in the top folder it
    // waits, and the filing form pre-fills it instead.
    if (!owner_set && parent !== top && item.ownerEmail) {
      const match = members.find((member) => member.google_email?.toLowerCase() === item.ownerEmail);
      if (match) {
        owner_id = match.user_id;
        owner_set = true;
      }
    }
    documents.push({
      drive_id: item.id,
      name: item.name,
      mime_type: item.mimeType,
      link: item.link,
      drive_owner_email: item.ownerEmail,
      parent_id: parent,
      owner_id,
      owner_set,
      missing: false,
    });
  }

  const seenFolders = new Set(folders.map((folder) => folder.drive_id));
  const seenDocuments = new Set(documents.map((document) => document.drive_id));
  return {
    folders,
    goneFolders: knownFolders.filter((row) => !row.missing && !seenFolders.has(row.drive_id)).map((row) => row.drive_id),
    documents,
    goneDocuments: knownDocuments.filter((row) => !row.missing && !seenDocuments.has(row.drive_id)).map((row) => row.drive_id),
  };
}

// The household member whose Google account owns a document in Drive, to
// pre-fill the owner when filing it.
export function ownerGuess(email: string | null, members: readonly SyncMember[]): string | null {
  if (!email) return null;
  return members.find((member) => member.google_email?.toLowerCase() === email.toLowerCase())?.user_id ?? null;
}
