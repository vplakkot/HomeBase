import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { readPaperwork } from "../../lib/paperwork/paperwork";
import { contentsPreview, entryId, readStorage, searchEntries, type StorageEntry } from "../../lib/storage/storage";
import { createClient } from "../../lib/supabase/server";
import { HeaderTools } from "./sheets";
import styles from "./storage.module.css";

// Who is looking at a Storage page, every entry, and Paperwork's files
// and documents for the ones archived in a box (REQ-98). Signed-out
// visitors go to sign-in.
export async function storageViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  const [canManageMembers, account, entries, paperwork] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    readAccount(data.claims),
    readStorage(supabase),
    readPaperwork(supabase),
  ]);
  return { canManageMembers, account, entries, ...paperwork };
}

export type StorageViewer = Awaited<ReturnType<typeof storageViewer>>;

// How many paperwork files are archived in each box, by entry id.
function archivedCounts(viewer: StorageViewer): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of viewer.files) {
    if (file.storage_entry_id) counts.set(file.storage_entry_id, (counts.get(file.storage_entry_id) ?? 0) + 1);
  }
  return counts;
}

export const filesArchived = (count: number) =>
  count === 1 ? "1 archived paperwork file" : `${count} archived paperwork files`;

// Every Storage screen (REQ-107): the module header with the one search
// and Add to storage, and below the top level a breadcrumb. With a
// search typed, the results take the screen's place; clearing it brings
// the screen back.
export function StorageScreen({
  viewer,
  here,
  query,
  crumb,
  children,
}: {
  viewer: StorageViewer;
  here: string;
  query: string;
  crumb?: string;
  children: ReactNode;
}) {
  const searching = query.trim() !== "";
  const last = searching ? `Results for “${query.trim()}”` : crumb;
  return (
    <ModuleFrame
      slug="storage"
      canManageMembers={viewer.canManageMembers}
      account={viewer.account}
      actions={<HeaderTools here={here} query={query} />}
    >
      <div className={styles.screen}>
        {/* Below the top level only: there it would just say Storage. */}
        {last ? (
          <nav aria-label="Breadcrumb">
            <ol className={styles.crumbs}>
              <li>
                <Link href="/storage">Storage</Link>
              </li>
              <li>
                <span aria-hidden="true">› </span>
                <span aria-current="page">{last}</span>
              </li>
            </ol>
          </nav>
        ) : null}
        {searching ? <SearchResults viewer={viewer} query={query} /> : children}
      </div>
    </ModuleFrame>
  );
}

// A section of a Storage screen: its heading with its count above, then
// its cards.
export function Section({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <h2 id={id} className={styles.sectionTitle}>
          {title} <span className={styles.count}>· {count}</span>
        </h2>
      </div>
      {children}
    </section>
  );
}

// Entries as cards that are their own links (REQ-107): ID · name, a short
// preview of the contents, the note, and how many paperwork files are
// archived in it.
export function EntryCards({ viewer, entries, none }: { viewer: StorageViewer; entries: StorageEntry[]; none: string }) {
  if (entries.length === 0) return <p className={styles.empty}>{none}</p>;
  const archived = archivedCounts(viewer);
  return (
    <ul className={styles.grid}>
      {entries.map((entry) => {
        const preview = contentsPreview(entry);
        const files = archived.get(entry.id) ?? 0;
        return (
          <li key={entry.id}>
            <Link href={`/storage/entries/${entry.id}`} className={styles.linkCard}>
              <span className={styles.cardTitle}>
                {entryId(entry)} · {entry.name}
              </span>
              {files > 0 ? <span className={styles.strong}>{filesArchived(files)}</span> : null}
              {preview ? <span className={styles.cardDetail}>{preview}</span> : null}
              {entry.note ? <span className={styles.note}>Note: {entry.note}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// REQ-107's search: entries by ID, name, contents or note. "ski boots"
// finds the box they're in.
function SearchResults({ viewer, query }: { viewer: StorageViewer; query: string }) {
  const found = searchEntries(viewer.entries, query);
  return (
    <Section id="results" title="Results" count={found.length}>
      <EntryCards viewer={viewer} entries={found} none="Nothing matches." />
    </Section>
  );
}
