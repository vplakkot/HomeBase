import type { SupabaseClient } from "@supabase/supabase-js";
import { entryId, type StorageEntry } from "../storage/storage";

// Paperwork (REQ-88, REQ-97): categories, the household's physical files,
// and the paperwork logged into them. A paper with no file is Unfiled.

export type Category = { id: string; name: string; keep_years: number | null };

export type PaperFile = {
  id: string;
  number: number;
  category_id: string;
  location: string;
  label: string | null;
  status: "active" | "archived";
  // The storage box an archived file is in (REQ-98); null while active.
  storage_entry_id: string | null;
};

export type Paper = {
  id: string;
  name: string;
  // null is Joint.
  owner_id: string | null;
  document_date: string | null;
  notes: string | null;
  keep_until: string | null;
  file_id: string | null;
  logged_on: string;
};

// What goes on the label: the number, padded to four digits, which never
// changes (REQ-88).
export function fileId(file: Pick<PaperFile, "number">): string {
  return `F-${String(file.number).padStart(4, "0")}`;
}

// What the label printer is given: "F-0042 · Taxes".
export function labelText(file: Pick<PaperFile, "number">, category: Pick<Category, "name"> | undefined): string {
  return category ? `${fileId(file)} · ${category.name}` : fileId(file);
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

// Where a file is (REQ-100): the office location it's kept in while
// active, or the storage box it's archived in (REQ-98). `href` opens that
// place's list of files.
export type Place = { name: string; href: string };

export function placeOf(
  file: Pick<PaperFile, "status" | "location" | "storage_entry_id">,
  storage: readonly StorageEntry[],
): Place {
  if (file.status === "archived" && file.storage_entry_id) {
    const box = storage.find((entry) => entry.id === file.storage_entry_id);
    return {
      name: box ? boxName(box) : "A storage box",
      href: `/paperwork/boxes/${file.storage_entry_id}`,
    };
  }
  return { name: file.location, href: locationHref(file.location) };
}

export function boxName(box: Pick<StorageEntry, "number" | "name">): string {
  return `Box ${entryId(box)} · ${box.name}`;
}

// A location is free text, so "Office · Cabinet" and "office  cabinet"
// are the same place: compared without case, spacing or dots.
export function sameLocation(a: string, b: string): boolean {
  const key = (text: string) => text.toLowerCase().replace(/[\s·.]+/g, " ").trim();
  return key(a) === key(b);
}

export function locationHref(location: string): string {
  return `/paperwork/locations/${encodeURIComponent(location)}`;
}

// REQ-100's first screen: one card per office location, then one per
// storage box holding archived files, each with its files and how many
// papers those hold. A location is spelt the way its first file spells it.
export type PlaceCard = Place & { files: FileRow[]; items: number };

export function places(
  files: readonly PaperFile[],
  categories: readonly Category[],
  papers: readonly Paper[],
  storage: readonly StorageEntry[],
): { office: PlaceCard[]; archived: PlaceCard[] } {
  const office: PlaceCard[] = [];
  const archived: PlaceCard[] = [];
  for (const row of fileRows(files, categories, papers)) {
    const place = placeOf(row.file, storage);
    const list = row.file.status === "archived" ? archived : office;
    const card = list.find((one) =>
      row.file.status === "archived" ? one.href === place.href : sameLocation(one.name, place.name),
    );
    if (card) {
      card.files.push(row);
      card.items += row.count;
    } else {
      list.push({ ...place, files: [row], items: row.count });
    }
  }
  const byName = (a: PlaceCard, b: PlaceCard) => a.name.localeCompare(b.name);
  return { office: office.sort(byName), archived: archived.sort(byName) };
}

// Every office location in use, for the location field's suggestions,
// so the same place keeps one spelling.
export function officeLocations(files: readonly PaperFile[]): string[] {
  const names: string[] = [];
  for (const file of files) {
    if (!names.some((name) => sameLocation(name, file.location))) names.push(file.location);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export function ownerName(paper: Pick<Paper, "owner_id">, people: { user_id: string; name: string }[]): string {
  if (paper.owner_id === null) return "Joint";
  return people.find((person) => person.user_id === paper.owner_id)?.name ?? "Someone";
}

export function unfiled(papers: readonly Paper[]): Paper[] {
  return papers.filter((paper) => paper.file_id === null);
}

// REQ-88: the files list, one row per file, with how many papers it holds.
export type FileRow = { file: PaperFile; category: Category | undefined; count: number };

export function fileRows(files: readonly PaperFile[], categories: readonly Category[], papers: readonly Paper[]): FileRow[] {
  return [...files]
    .sort((a, b) => a.number - b.number)
    .map((file) => ({
      file,
      category: categories.find((category) => category.id === file.category_id),
      count: papers.filter((paper) => paper.file_id === file.id).length,
    }));
}

// REQ-88: find files by ID, label or category, and paperwork by name. The
// ID matches however it's typed: "F-0042", "f42" or "42". A category
// filter narrows the files, and the paperwork to what's in them.
export function search(
  rows: readonly FileRow[],
  papers: readonly Paper[],
  query: string,
  categoryId: string | null,
): { files: FileRow[]; papers: Paper[] } {
  const words = query.trim().toLowerCase();
  const inCategory = rows.filter((row) => !categoryId || row.file.category_id === categoryId);
  if (words === "") return { files: inCategory, papers: [] };
  const asNumber = words.match(/^(?:f-?)?0*(\d+)$/)?.[1];
  const files = inCategory.filter(
    (row) =>
      (asNumber !== undefined && row.file.number === Number(asNumber)) ||
      (row.file.label ?? "").toLowerCase().includes(words) ||
      (row.category?.name ?? "").toLowerCase().includes(words),
  );
  const allowed = new Set(inCategory.map((row) => row.file.id));
  const found = papers.filter(
    (paper) =>
      paper.name.toLowerCase().includes(words) && (!categoryId || (paper.file_id !== null && allowed.has(paper.file_id))),
  );
  return { files, papers: found };
}

// Everything a Paperwork page reads, in one go. The household is small, so
// every page reads it all and works out what it shows.
export async function readPaperwork(
  supabase: SupabaseClient,
): Promise<{ categories: Category[]; files: PaperFile[]; papers: Paper[] }> {
  const [categories, files, papers] = await Promise.all([
    supabase.from("paperwork_categories").select("id, name, keep_years").order("name"),
    supabase.from("paperwork_files").select("id, number, category_id, location, label, status, storage_entry_id").order("number"),
    supabase
      .from("paperwork")
      .select("id, name, owner_id, document_date, notes, keep_until, file_id, logged_on")
      .order("created_at", { ascending: false }),
  ]);
  for (const result of [categories, files, papers]) {
    if (result.error) throw new Error(`Could not read Paperwork: ${result.error.message}`);
  }
  return {
    categories: (categories.data ?? []) as Category[],
    files: ((files.data ?? []) as PaperFile[]).map((file) => ({ ...file, number: Number(file.number) })),
    papers: (papers.data ?? []) as Paper[],
  };
}

// How many papers are Unfiled, for Home, without reading the rest.
export async function countUnfiled(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("paperwork")
    .select("id", { count: "exact", head: true })
    .is("file_id", null);
  if (error) throw new Error(`Could not count unfiled paperwork: ${error.message}`);
  return count ?? 0;
}
