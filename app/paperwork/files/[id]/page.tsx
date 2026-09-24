import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../../../components/cards.module.css";
import { Hint } from "../../../../components/hint";
import { fileId, labelText, ownerName, whereItIs } from "../../../../lib/paperwork/paperwork";
import { boxes } from "../../../../lib/storage/storage";
import { removeFile } from "../../actions";
import { ArchiveFileForm, BringBackForm, FileEditForm } from "../../forms";
import { PaperworkFrame, paperworkViewer } from "../../frame";
import local from "../../../../components/tiles.module.css";

// One file (REQ-88): the label to print, every paper in it, and its
// category, location and label name to change. Archiving it to a storage
// box, or bringing it back, is here too (REQ-98). ?new=1 is how a page that
// just made the file says so.
export default async function FilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ id }, { new: made }] = await Promise.all([params, searchParams]);
  const { canManageMembers, account, people, categories, files, papers, storage } = await paperworkViewer();
  const file = files.find((row) => row.id === id);
  if (!file) notFound();
  const category = categories.find((row) => row.id === file.category_id);
  const inside = papers.filter((paper) => paper.file_id === file.id);
  const label = labelText(file, category);

  return (
    <PaperworkFrame canManageMembers={canManageMembers} account={account} section={fileId(file)}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="file">
          <header className={styles.head}>
            <h2 id="file" className={styles.name}>
              {made ? "New file: print its label" : label}
            </h2>
            <Hint text="Type this into your label printer. The ID never changes, even if the category does." />
          </header>
          <div className={styles.entries}>
            <p className={local.label} aria-label={`Label: ${label}`}>
              {label}
            </p>
          </div>
          <div className={styles.entries}>
            <p className={styles.empty}>
              {file.status === "archived" ? "Archived · " : "Active · "}
              {file.label ? `${file.label} · ` : ""}
              {whereItIs(file, storage)}
            </p>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="inside">
          <header className={styles.head}>
            <h2 id="inside" className={styles.name}>
              In this file
            </h2>
          </header>
          <div className={styles.entries}>
            {inside.length === 0 ? (
              <p className={styles.empty}>Nothing in it yet.</p>
            ) : (
              <ul className={styles.list}>
                {inside.map((paper) => (
                  <li key={paper.id} className={styles.entry}>
                    <Link href={`/paperwork/items/${paper.id}`} className={local.tileLink}>
                      <span className={local.title}>{paper.name}</span>
                      <span className={styles.detail}>
                        {[
                          ownerName(paper, people),
                          paper.document_date ? `Dated ${paper.document_date}` : null,
                          paper.keep_until ? `Keep until ${paper.keep_until}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {file.status === "archived" ? (
          <section className={styles.card} aria-labelledby="bring-back">
            <header className={styles.head}>
              <h2 id="bring-back" className={styles.name}>
                Bring it back
              </h2>
              <Hint text="Say where it's kept in the office now, and it's Active again." />
            </header>
            <div className={styles.addBlock}>
              <BringBackForm file={file} />
            </div>
          </section>
        ) : (
          <section className={styles.card} aria-labelledby="archive">
            <header className={styles.head}>
              <h2 id="archive" className={styles.name}>
                Archive to storage
              </h2>
              <Hint text="The whole file goes into a storage box. To keep some of it, move that paperwork to another file first." />
            </header>
            <div className={styles.addBlock}>
              {boxes(storage).length === 0 ? (
                <Link href="/storage/add" className={styles.primary}>
                  Add a box in Storage first
                </Link>
              ) : (
                <ArchiveFileForm file={file} boxes={boxes(storage)} />
              )}
            </div>
          </section>
        )}

        <section className={styles.card} aria-labelledby="change-file">
          <header className={styles.head}>
            <h2 id="change-file" className={styles.name}>
              Change the file
            </h2>
            <Hint text="A file that moved gets its new location here. The old one is replaced." />
          </header>
          <div className={styles.addBlock}>
            <FileEditForm file={file} categories={categories} />
            <form action={removeFile} className={`${styles.actions} ${styles.form}`}>
              <input type="hidden" name="id" value={file.id} />
              <button type="submit" className={styles.quiet} aria-label={`Remove ${fileId(file)}`}>
                Remove the file
              </button>
              <Hint text={`Its paperwork goes back to Unfiled. ${fileId(file)} is never given to another file.`} />
            </form>
          </div>
        </section>
      </div>
    </PaperworkFrame>
  );
}
