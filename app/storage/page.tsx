import Link from "next/link";
import styles from "../../components/cards.module.css";
import { Hint } from "../../components/hint";
import local from "../../components/tiles.module.css";
import { contentsPreview, entryId, searchEntries } from "../../lib/storage/storage";
import { StorageFrame, storageViewer } from "./frame";

// Storage's home (REQ-87): every entry, found by ID, name, contents or
// note. Any member sees them all.
export default async function StoragePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { canManageMembers, account, entries } = await storageViewer();
  const { q = "" } = await searchParams;
  const found = searchEntries(entries, q);
  const searching = q.trim() !== "";

  return (
    <StorageFrame canManageMembers={canManageMembers} account={account}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="entries">
          <header className={styles.head}>
            <h2 id="entries" className={styles.name}>
              Search
            </h2>
            <Hint text="Find an entry by its ID, name, what's in it or its note. Searching ski boots finds the box they're in." />
          </header>
          <div className={styles.addBlock}>
            <form method="get" className={styles.form} role="search">
              <label className={styles.field}>
                <span>Search</span>
                <input name="q" defaultValue={q} placeholder="S-003, a name or something in a box" />
              </label>
              <button type="submit" className={styles.primary}>
                Search
              </button>
              {searching ? (
                <Link href="/storage" className={styles.quiet}>
                  Show everything
                </Link>
              ) : null}
            </form>
          </div>
          <div className={styles.entries}>
            {found.length === 0 ? (
              <p className={styles.empty}>{searching ? "Nothing matches." : "Nothing logged yet."}</p>
            ) : (
              <ul className={styles.list}>
                {found.map((entry) => {
                  const preview = contentsPreview(entry);
                  return (
                    <li key={entry.id} className={styles.entry}>
                      <Link href={`/storage/entries/${entry.id}`} className={local.tileLink}>
                        <span className={styles.entryHead}>
                          <span className={local.title}>
                            {entryId(entry)} · {entry.name}
                          </span>
                          <span className={styles.chip}>{entry.is_box ? "Box" : "Not a box"}</span>
                        </span>
                        {preview ? <span className={styles.detail}>{preview}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </StorageFrame>
  );
}
