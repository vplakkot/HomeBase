import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../../../components/cards.module.css";
import { Hint } from "../../../../components/hint";
import local from "../../../../components/tiles.module.css";
import { labelText, readPaperwork } from "../../../../lib/paperwork/paperwork";
import { contentLines, entryId } from "../../../../lib/storage/storage";
import { EntryForm, RemoveEntryForm } from "../../forms";
import { StorageFrame, storageViewer } from "../../frame";

// One entry (REQ-87): its ID for the label, everything in it, its note,
// and any paperwork files archived into it (REQ-98). ?new=1 is how the
// add page says it was just made.
export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ id }, { new: made }] = await Promise.all([params, searchParams]);
  const { supabase, canManageMembers, account, entries } = await storageViewer();
  const entry = entries.find((row) => row.id === id);
  if (!entry) notFound();
  const { categories, files } = await readPaperwork(supabase);
  const archived = files.filter((file) => file.storage_entry_id === entry.id);
  const label = entryId(entry);
  const lines = contentLines(entry);

  return (
    <StorageFrame canManageMembers={canManageMembers} account={account} section={label}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="entry">
          <header className={styles.head}>
            <h2 id="entry" className={styles.name}>
              {made ? `New: ${entry.is_box ? "label the box" : "its ID"}` : entry.name}
            </h2>
            <Hint text="Type the ID into your label printer. It never changes." />
          </header>
          <div className={styles.entries}>
            <p className={local.label} aria-label={`ID: ${label}`}>
              {label}
            </p>
          </div>
          <div className={styles.entries}>
            <p className={styles.empty}>
              {entry.name} · {entry.is_box ? "Box" : "Not a box"}
            </p>
            {entry.note ? <p className={styles.empty}>{entry.note}</p> : null}
          </div>
        </section>

        {entry.is_box ? (
          <section className={styles.card} aria-labelledby="inside">
            <header className={styles.head}>
              <h2 id="inside" className={styles.name}>
                In this box
              </h2>
            </header>
            <div className={styles.entries}>
              {lines.length === 0 && archived.length === 0 ? (
                <p className={styles.empty}>Nothing listed yet.</p>
              ) : (
                <ul className={styles.list}>
                  {lines.length > 0 ? (
                    <li className={styles.entry}>
                      <ul className={local.lines} aria-label="Contents">
                        {lines.map((line, index) => (
                          <li key={index}>{line}</li>
                        ))}
                      </ul>
                    </li>
                  ) : null}
                  {archived.map((file) => (
                    <li key={file.id} className={styles.entry}>
                      <Link href={`/paperwork/files/${file.id}`} className={local.tileLink}>
                        <span className={local.title}>
                          {labelText(file, categories.find((row) => row.id === file.category_id))}
                        </span>
                        <span className={styles.detail}>
                          Archived paperwork file{file.label ? ` · ${file.label}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="change-entry">
          <header className={styles.head}>
            <h2 id="change-entry" className={styles.name}>
              Change the entry
            </h2>
            <Hint text={`Change anything, box or not included. ${label} stays.`} />
          </header>
          <div className={styles.addBlock}>
            <EntryForm entry={entry} />
            <RemoveEntryForm entry={entry} label={label} />
          </div>
        </section>
      </div>
    </StorageFrame>
  );
}
