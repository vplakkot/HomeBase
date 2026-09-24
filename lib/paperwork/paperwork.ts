import type { SupabaseClient } from "@supabase/supabase-js";

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
    supabase.from("paperwork_files").select("id, number, category_id, location, label, status").order("number"),
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
