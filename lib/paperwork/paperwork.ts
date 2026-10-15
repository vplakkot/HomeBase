import type { SupabaseClient } from "@supabase/supabase-js";
import { entryId, type StorageEntry } from "../storage/storage";
import type { DriveConnection, DriveDocument, DriveFolder, SyncMember } from "./drive-sync";

// Paperwork (REQ-88, REQ-97): categories, the household's physical File Folders,
// and the paperwork logged into them. A paper with no File Folder is Unfiled.

export type Category = { id: string; name: string; keep_years: number | null };

// A place File Folders are kept (REQ-179): its own record, so it can be set up
// before any File Folder uses it, renamed in one go and removed once empty.
// `built_in` is "drive" for Google Drive (REQ-152): it can't be renamed or
// removed, and only Drive File Folders are kept there.
export type Location = { id: string; name: string; built_in: string | null };

export type PaperFileFolder = {
  id: string;
  number: number;
  category_id: string;
  // The office location it's kept in; an archived File Folder keeps its last one
  // while it's in storage, and goes back there to be brought back. Null is
  // "Not placed" (REQ-206): a physical File Folder made before its place is known.
  location_id: string | null;
  label: string | null;
  status: "active" | "archived";
  // The storage box an archived File Folder is in (REQ-98); null while active.
  storage_entry_id: string | null;
  // A Google Drive File Folder (REQ-152): its paperwork is a folder in Drive,
  // linked by the folder's Drive ID (null while it waits for the folder
  // to be made). Set when the File Folder is made and never changes.
  is_drive: boolean;
  drive_folder_id: string | null;
};

export type Paper = {
  id: string;
  name: string;
  // null is Joint.
  owner_id: string | null;
  document_date: string | null;
  notes: string | null;
  keep_until: string | null;
  file_folder_id: string | null;
  // The box archive it's in (REQ-153); null unless archived on its own. A
  // document is in a File Folder, in an archive, or Unfiled.
  archive_id: string | null;
  logged_on: string;
};

// A storage box's archive (REQ-153): holds documents archived on their
// own, one per box, made when the first goes in. It isn't a File Folder: no F-ID,
// no category, no label.
export type Archive = { id: string; storage_entry_id: string };

// What goes on the label: the number, padded to four digits, which never
// changes (REQ-88).
export function fileFolderId(fileFolder: Pick<PaperFileFolder, "number">): string {
  return `F-${String(fileFolder.number).padStart(4, "0")}`;
}

// What the label printer is given: "F-0042 · Taxes".
export function labelText(fileFolder: Pick<PaperFileFolder, "number">, category: Pick<Category, "name"> | undefined): string {
  return category ? `${fileFolderId(fileFolder)} · ${category.name}` : fileFolderId(fileFolder);
}

// REQ-97: keep-until starts at the document date plus the category's
// years, or the day it was logged when there's no document date.
export function keepUntil(documentDate: string | null, loggedOn: string, years: number | null): string | null {
  if (years === null) return null;
  const [year, month, day] = (documentDate || loggedOn).split("-").map(Number);
  // 29 February lands on 28 February in a year that has none.
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return `${year + years}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

// Where a File Folder is (REQ-100): the office location it's kept in while
// active, or the storage box it's archived in (REQ-98). `href` opens that
// place's list of File Folders.
export type Place = { name: string; href: string };

export function placeOf(
  fileFolder: Pick<PaperFileFolder, "status" | "location_id" | "storage_entry_id"> & { is_drive?: boolean },
  storage: readonly StorageEntry[],
  locations: readonly Location[],
): Place {
  if (fileFolder.is_drive && fileFolder.status === "archived") return DRIVE_ARCHIVE_PLACE;
  if (fileFolder.status === "archived" && fileFolder.storage_entry_id) return boxPlace(fileFolder.storage_entry_id, storage);
  if (fileFolder.location_id === null) return NOT_PLACED_PLACE;
  const location = locations.find((row) => row.id === fileFolder.location_id);
  return location ? locationPlace(location) : { name: "Somewhere", href: "/paperwork" };
}

// A physical File Folder with no location yet (REQ-206). It isn't a
// location record: it can't be renamed or removed, and it goes the moment
// the File Folder is given a place.
export const NOT_PLACED_HREF = "/paperwork/not-placed";
const NOT_PLACED_PLACE: Place = { name: "Not placed", href: NOT_PLACED_HREF };

export const isNotPlaced = (fileFolder: Pick<PaperFileFolder, "status" | "location_id" | "is_drive">) =>
  fileFolder.status === "active" && !fileFolder.is_drive && fileFolder.location_id === null;

// Drive's archive (REQ-153): the `Archived` folder, with the Drive File Folders
// archived into it.
export const DRIVE_ARCHIVE_HREF = "/paperwork/archives/drive";
const DRIVE_ARCHIVE_PLACE: Place = { name: "Google Drive · Archived", href: DRIVE_ARCHIVE_HREF };

function boxPlace(id: string, storage: readonly StorageEntry[]): Place {
  const box = storage.find((entry) => entry.id === id);
  return { name: box ? boxName(box) : "A storage box", href: `/paperwork/boxes/${id}` };
}

const locationPlace = (location: Location): Place => ({ name: location.name, href: locationHref(location.id) });

export function boxName(box: Pick<StorageEntry, "number" | "name">): string {
  return `Box ${entryId(box)} · ${box.name}`;
}

// "Archive · S-003": an archive is named for its box, never stored.
export function archiveName(box: Pick<StorageEntry, "number"> | undefined): string {
  return box ? `Archive · ${entryId(box)}` : "Archive";
}

// "Hall cupboard" and "hall  cupboard" are the same location: compared
// without case or extra spaces (REQ-179). What's stored is the name with
// its spaces tidied.
export function tidyName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function sameLocation(a: string, b: string): boolean {
  return tidyName(a).toLowerCase() === tidyName(b).toLowerCase();
}

export function locationHref(id: string): string {
  return `/paperwork/locations/${id}`;
}

// REQ-100's first screen: one card per location (empty ones too, REQ-179),
// then one per storage box holding archived File Folders or an archive, each with
// its File Folders and how many papers those hold. An archive counts as a File Folder
// here, as it's listed with the box's File Folders (REQ-153).
export type PlaceCard = Place & { fileFolders: FileFolderRow[]; archive: ArchiveRow | null; items: number };

export function places(
  fileFolders: readonly PaperFileFolder[],
  categories: readonly Category[],
  papers: readonly Paper[],
  storage: readonly StorageEntry[],
  locations: readonly Location[] = [],
  archives: readonly Archive[] = [],
  drive?: DriveState,
): { office: PlaceCard[]; archived: PlaceCard[]; notPlaced: PlaceCard | null } {
  const rows = fileFolderRows(fileFolders, categories, papers, drive);
  const office: PlaceCard[] = locations.map((location) => {
    const here = rows.filter((row) => row.fileFolder.status === "active" && row.fileFolder.location_id === location.id);
    return { ...locationPlace(location), fileFolders: here, archive: null, items: here.reduce((sum, row) => sum + row.count, 0) };
  });
  const archived: PlaceCard[] = [];
  const card = (boxId: string) => {
    let found = archived.find((one) => one.href === `/paperwork/boxes/${boxId}`);
    if (!found) {
      found = { ...boxPlace(boxId, storage), fileFolders: [], archive: null, items: 0 };
      archived.push(found);
    }
    return found;
  };
  for (const row of rows) {
    if (row.fileFolder.status !== "archived" || row.fileFolder.is_drive) continue;
    if (!row.fileFolder.storage_entry_id) continue;
    const one = card(row.fileFolder.storage_entry_id);
    one.fileFolders.push(row);
    one.items += row.count;
  }
  // Drive's own archive, when it has archived File Folders or loose documents.
  const driveArchived = rows.filter((row) => row.fileFolder.is_drive && row.fileFolder.status === "archived");
  const loose = drive ? driveArchiveDocuments(drive) : [];
  if (driveArchived.length > 0 || loose.length > 0) {
    archived.push({
      ...DRIVE_ARCHIVE_PLACE,
      fileFolders: driveArchived,
      archive: loose.length > 0 || drive?.connection ? { archive: { id: "drive", storage_entry_id: "" }, count: loose.length } : null,
      items: driveArchived.reduce((sum, row) => sum + row.count, 0) + loose.length,
    });
  }
  for (const archive of archiveRows(archives, papers)) {
    const one = card(archive.archive.storage_entry_id);
    one.archive = archive;
    one.items += archive.count;
  }
  const byName = (a: PlaceCard, b: PlaceCard) => a.name.localeCompare(b.name);
  const unplaced = rows.filter((row) => isNotPlaced(row.fileFolder));
  const notPlaced: PlaceCard | null =
    unplaced.length > 0
      ? { ...NOT_PLACED_PLACE, fileFolders: unplaced, archive: null, items: unplaced.reduce((sum, row) => sum + row.count, 0) }
      : null;
  return { office: office.sort(byName), archived: archived.sort(byName), notPlaced };
}

// How many File Folders a card shows, its archive counted as one.
export const cardFileFolders = (card: Pick<PlaceCard, "fileFolders" | "archive">) => card.fileFolders.length + (card.archive ? 1 : 0);

// Every location by name, for the pickers.
export function sortedLocations(locations: readonly Location[]): Location[] {
  return [...locations].sort((a, b) => a.name.localeCompare(b.name));
}

export type ArchiveRow = { archive: Archive; count: number };

export function archiveRows(archives: readonly Archive[], papers: readonly Paper[]): ArchiveRow[] {
  return archives.map((archive) => ({ archive, count: papers.filter((paper) => paper.archive_id === archive.id).length }));
}

export function ownerName(paper: Pick<Paper, "owner_id">, people: { user_id: string; name: string }[]): string {
  if (paper.owner_id === null) return "Joint";
  return people.find((person) => person.user_id === paper.owner_id)?.name ?? "Someone";
}

export function unfiled(papers: readonly Pick<Paper, "file_folder_id" | "archive_id">[]): Paper[] {
  return papers.filter((paper) => paper.file_folder_id === null && paper.archive_id === null) as Paper[];
}

// REQ-88: the File Folders list, one row per File Folder, with how many papers it holds.
export type FileFolderRow = { fileFolder: PaperFileFolder; category: Category | undefined; count: number };

export function fileFolderRows(
  fileFolders: readonly PaperFileFolder[],
  categories: readonly Category[],
  papers: readonly Paper[],
  drive?: Pick<DriveState, "documents">,
): FileFolderRow[] {
  return [...fileFolders]
    .sort((a, b) => a.number - b.number)
    .map((fileFolder) => ({
      fileFolder,
      category: categories.find((category) => category.id === fileFolder.category_id),
      count: fileFolder.is_drive
        ? inDriveFolder(drive?.documents ?? [], fileFolder.drive_folder_id).length
        : papers.filter((paper) => paper.file_folder_id === fileFolder.id).length,
    }));
}

// REQ-88: find File Folders by ID, label or category, and paperwork by name. The
// ID matches however it's typed: "F-0042", "f42" or "42". A category
// filter narrows the File Folders, and the paperwork to what's in them.
export function search(
  rows: readonly FileFolderRow[],
  papers: readonly Paper[],
  query: string,
  categoryId: string | null,
): { fileFolders: FileFolderRow[]; papers: Paper[] } {
  const words = query.trim().toLowerCase();
  const inCategory = rows.filter((row) => !categoryId || row.fileFolder.category_id === categoryId);
  if (words === "") return { fileFolders: inCategory, papers: [] };
  const asNumber = words.match(/^(?:f-?)?0*(\d+)$/)?.[1];
  const fileFolders = inCategory.filter(
    (row) =>
      (asNumber !== undefined && row.fileFolder.number === Number(asNumber)) ||
      (row.fileFolder.label ?? "").toLowerCase().includes(words) ||
      (row.category?.name ?? "").toLowerCase().includes(words),
  );
  const allowed = new Set(inCategory.map((row) => row.fileFolder.id));
  const found = papers.filter(
    (paper) =>
      paper.name.toLowerCase().includes(words) && (!categoryId || (paper.file_folder_id !== null && allowed.has(paper.file_folder_id))),
  );
  return { fileFolders, papers: found };
}

// Everything a Paperwork page reads, in one go. The household is small, so
// every page reads it all and works out what it shows.
export async function readPaperwork(
  supabase: SupabaseClient,
): Promise<{
  categories: Category[];
  fileFolders: PaperFileFolder[];
  papers: Paper[];
  locations: Location[];
  archives: Archive[];
  drive: DriveState;
  members: SyncMember[];
}> {
  const [categories, fileFolders, papers, locations, archives, connection, folders, documents, members] = await Promise.all([
    supabase.from("paperwork_categories").select("id, name, keep_years").order("name"),
    supabase
      .from("paperwork_file_folders")
      .select("id, number, category_id, location_id, label, status, storage_entry_id, is_drive, drive_folder_id")
      .order("number"),
    supabase
      .from("paperwork")
      .select("id, name, owner_id, document_date, notes, keep_until, file_folder_id, archive_id, logged_on")
      .order("created_at", { ascending: false }),
    supabase.from("paperwork_locations").select("id, name, built_in").order("name"),
    supabase.from("paperwork_archives").select("id, storage_entry_id"),
    supabase.from("paperwork_drive").select("folder_id, archived_folder_id, synced_at").maybeSingle(),
    supabase.from("paperwork_drive_folders").select("drive_id, name, in_archived, ignored, missing"),
    supabase
      .from("paperwork_drive_documents")
      .select("drive_id, name, mime_type, link, drive_owner_email, parent_id, owner_id, owner_set, missing")
      .order("name"),
    // Each member's Google account for matching Drive owners: the one the
    // admin saved, else their sign-in email.
    supabase.rpc("paperwork_member_accounts"),
  ]);
  for (const result of [categories, fileFolders, papers, locations, archives, connection, folders, documents, members]) {
    if (result.error) throw new Error(`Could not read Paperwork: ${result.error.message}`);
  }
  return {
    categories: (categories.data ?? []) as Category[],
    fileFolders: ((fileFolders.data ?? []) as PaperFileFolder[]).map((fileFolder) => ({ ...fileFolder, number: Number(fileFolder.number) })),
    papers: (papers.data ?? []) as Paper[],
    locations: (locations.data ?? []) as Location[],
    archives: (archives.data ?? []) as Archive[],
    drive: {
      connection: (connection.data ?? null) as DriveConnection | null,
      folders: (folders.data ?? []) as DriveFolder[],
      documents: (documents.data ?? []) as DriveDocument[],
    },
    members: (members.data ?? []) as SyncMember[],
  };
}

// How many papers are Unfiled, for Home, without reading the rest.
export async function countUnfiled(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("paperwork")
    .select("id", { count: "exact", head: true })
    .is("file_folder_id", null)
    .is("archive_id", null);
  if (error) throw new Error(`Could not count unfiled paperwork: ${error.message}`);
  return count ?? 0;
}

// REQ-105: the Categories tab, one card per category with how many File Folders
// it has and how many documents those hold.
export type CategoryCard = { category: Category; fileFolders: number; documents: number };

export function categoryCards(
  categories: readonly Category[],
  fileFolders: readonly PaperFileFolder[],
  papers: readonly Paper[],
): CategoryCard[] {
  return categories.map((category) => {
    const ids = new Set(fileFolders.filter((fileFolder) => fileFolder.category_id === category.id).map((fileFolder) => fileFolder.id));
    return {
      category,
      fileFolders: ids.size,
      documents: papers.filter((paper) => paper.file_folder_id !== null && ids.has(paper.file_folder_id)).length,
    };
  });
}

// REQ-204: a category's page lists its File Folders, each with its
// documents one tap away. Sorted by label name (File Folders with no label
// last, by ID); a File Folder's documents by keep-until, soonest first,
// those with none last by name.
export type CategoryDocument = {
  key: string;
  name: string;
  owner: string;
  documentDate: string | null;
  keepUntil: string | null;
  // A HomeBase document opens its details; a Google Drive one opens in Drive.
  href: string;
  external: boolean;
};

export type CategoryFileFolder = {
  row: FileFolderRow;
  place: Place;
  archived: boolean;
  documents: CategoryDocument[];
};

export function categoryFileFolders(
  rows: readonly FileFolderRow[],
  papers: readonly Paper[],
  people: { user_id: string; name: string }[],
  storage: readonly StorageEntry[],
  locations: readonly Location[],
  drive: Pick<DriveState, "documents">,
): CategoryFileFolder[] {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const byKeepUntil = (a: CategoryDocument, b: CategoryDocument) =>
    a.keepUntil && b.keepUntil ? a.keepUntil.localeCompare(b.keepUntil) || byName(a, b) : a.keepUntil ? -1 : b.keepUntil ? 1 : byName(a, b);
  const sorted = [...rows].sort((a, b) => {
    const left = a.fileFolder.label?.trim();
    const right = b.fileFolder.label?.trim();
    if (left && right) return left.localeCompare(right) || a.fileFolder.number - b.fileFolder.number;
    if (left) return -1;
    if (right) return 1;
    return a.fileFolder.number - b.fileFolder.number;
  });
  return sorted.map((row) => {
    const { fileFolder } = row;
    const documents: CategoryDocument[] = fileFolder.is_drive
      ? inDriveFolder(drive.documents, fileFolder.drive_folder_id).map((document) => ({
          key: document.drive_id,
          name: document.name,
          owner: document.owner_set ? ownerName({ owner_id: document.owner_id }, people) : "Owner not set",
          documentDate: null,
          keepUntil: null,
          href: document.link ?? "/paperwork",
          external: document.link !== null,
        }))
      : papers
          .filter((paper) => paper.file_folder_id === fileFolder.id)
          .map((paper) => ({
            key: paper.id,
            name: paper.name,
            owner: ownerName(paper, people),
            documentDate: paper.document_date,
            keepUntil: paper.keep_until,
            href: `/paperwork/items/${paper.id}`,
            external: false,
          }));
    return {
      row,
      place: placeOf(fileFolder, storage, locations),
      archived: fileFolder.status === "archived",
      documents: documents.sort(byKeepUntil),
    };
  });
}

// "1 document", "18 documents": the UI calls each paper a document
// (Vin, 2026-09-25); the module is still Paperwork.
export const documentsCount = (count: number) => (count === 1 ? "1 document" : `${count} documents`);
export const fileFoldersCount = (count: number) => (count === 1 ? "1 File Folder" : `${count} File Folders`);

// What HomeBase remembers of the connected Google Drive folder (REQ-152),
// as of the last sync.
export type DriveState = { connection: DriveConnection | null; folders: DriveFolder[]; documents: DriveDocument[] };

// Documents directly in one folder, as of the last sync. Ones Drive no
// longer has aren't counted (they show as Missing until removed).
export const inDriveFolder = (documents: readonly DriveDocument[], folderId: string | null) =>
  folderId ? documents.filter((document) => document.parent_id === folderId && !document.missing) : [];

// REQ-152: loose documents in the connected folder, waiting to be filed.
export const driveUnfiled = (drive: Pick<DriveState, "connection" | "documents">): DriveDocument[] =>
  drive.connection ? drive.documents.filter((document) => document.parent_id === drive.connection!.folder_id) : [];

// REQ-153: loose documents in `Archived`, the contents of Drive's
// archive File Folder.
export const driveArchiveDocuments = (drive: Pick<DriveState, "connection" | "documents">): DriveDocument[] =>
  drive.connection
    ? drive.documents.filter((document) => document.parent_id === drive.connection!.archived_folder_id && !document.missing)
    : [];

// Where a Drive File Folder's folder stands: not made yet, gone from Drive, or
// there.
export type DriveFileFolderState =
  | { kind: "waiting" }
  | { kind: "missing" }
  | { kind: "linked"; folder: DriveFolder; documents: DriveDocument[] };

export function driveFileFolderState(fileFolder: Pick<PaperFileFolder, "drive_folder_id">, drive: Pick<DriveState, "folders" | "documents">): DriveFileFolderState {
  if (!fileFolder.drive_folder_id) return { kind: "waiting" };
  const folder = drive.folders.find((row) => row.drive_id === fileFolder.drive_folder_id);
  if (!folder || folder.missing) return { kind: "missing" };
  return { kind: "linked", folder, documents: drive.documents.filter((document) => document.parent_id === folder.drive_id) };
}

// The folder name a File Folder should have in Drive: "F-0042_Taxes_2025 Returns".
export function expectedFolderName(fileFolder: Pick<PaperFileFolder, "number" | "label">, category: Pick<Category, "name"> | undefined): string {
  const name = category?.name ?? "";
  const label = fileFolder.label?.trim();
  const tidy = (text: string) => text.replace(/\//g, "-").replace(/\s+/g, " ").trim();
  return label ? `${fileFolderId(fileFolder)}_${tidy(name)}_${tidy(label)}` : `${fileFolderId(fileFolder)}_${tidy(name)}`;
}

// REQ-152: sub-folders nobody has linked to a File Folder (and the admin hasn't
// ignored), which can be linked to a File Folder waiting for its Digital Folder.
export function unlinkedFolders(drive: Pick<DriveState, "folders">, fileFolders: readonly Pick<PaperFileFolder, "drive_folder_id">[]): DriveFolder[] {
  const linked = new Set(fileFolders.map((fileFolder) => fileFolder.drive_folder_id));
  return drive.folders.filter((folder) => !folder.missing && !folder.ignored && !linked.has(folder.drive_id));
}
