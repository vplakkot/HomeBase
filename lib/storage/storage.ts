import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleStatus } from "../module-status";

// Storage (REQ-87): everything in the basement, boxed or not. A box can
// also hold archived paperwork files (REQ-98).

export type StorageEntry = {
  id: string;
  number: number;
  name: string;
  is_box: boolean;
  // One item per line; boxes only.
  contents: string | null;
  note: string | null;
};

// What goes on the label: the number, padded to three digits, which never
// changes (REQ-87).
export function entryId(entry: Pick<StorageEntry, "number">): string {
  return `S-${String(entry.number).padStart(3, "0")}`;
}

// A box's contents, one item per line, blank lines dropped.
export function contentLines(entry: Pick<StorageEntry, "contents">): string[] {
  return (entry.contents ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// The list's short preview: the first few items, and how many more.
export function contentsPreview(entry: Pick<StorageEntry, "contents">, shown = 3): string | null {
  const lines = contentLines(entry);
  if (lines.length === 0) return null;
  const more = lines.length - shown;
  return lines.slice(0, shown).join(", ") + (more > 0 ? `, and ${more} more` : "");
}

// REQ-87: find entries by ID, name, contents or note. The ID matches
// however it's typed: "S-003", "s3" or "3". "ski boots" finds the box
// they're in.
export function searchEntries(entries: readonly StorageEntry[], query: string): StorageEntry[] {
  const words = query.trim().toLowerCase();
  if (words === "") return [...entries];
  const asNumber = words.match(/^(?:s-?)?0*(\d+)$/)?.[1];
  return entries.filter(
    (entry) =>
      (asNumber !== undefined && entry.number === Number(asNumber)) ||
      [entry.name, entry.contents ?? "", entry.note ?? ""].some((field) => field.toLowerCase().includes(words)),
  );
}

export function boxes(entries: readonly StorageEntry[]): StorageEntry[] {
  return entries.filter((entry) => entry.is_box);
}

export async function readStorage(supabase: SupabaseClient): Promise<StorageEntry[]> {
  const { data, error } = await supabase
    .from("storage_entries")
    .select("id, number, name, is_box, contents, note")
    .order("number");
  if (error) throw new Error(`Could not read Storage: ${error.message}`);
  return ((data ?? []) as StorageEntry[]).map((entry) => ({ ...entry, number: Number(entry.number) }));
}

// How many entries there are, for Home, without reading them.
export async function countEntries(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase.from("storage_entries").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not count Storage: ${error.message}`);
  return count ?? 0;
}

// Home's tile. Storage raises nothing that needs someone, so it's always
// calm and just says how much is logged.
export function storageTile(count: number): ModuleStatus {
  const status = count === 0 ? "Nothing logged yet" : count === 1 ? "1 entry" : `${count} entries`;
  return { status, headline: status, facts: [], actionItems: [] };
}
