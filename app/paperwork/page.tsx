import Link from "next/link";
import styles from "../../components/cards.module.css";
import { Hint } from "../../components/hint";
import { fileRows, labelText, ownerName, search, whereItIs } from "../../lib/paperwork/paperwork";
import { NewFileForm } from "./forms";
import { PaperworkFrame, paperworkViewer } from "./frame";
import local from "../../components/tiles.module.css";

// Paperwork's home: every file (REQ-88), found by ID, label name or
// category, and paperwork found by name. Archived files show only when
// asked for (REQ-98). Any member sees them all.
export default async function PaperworkPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; archived?: string }>;
}) {
  const { canManageMembers, canManagePaperwork, account, people, categories, files, papers, storage } =
    await paperworkViewer();
  const { q = "", category = "", archived = "" } = await searchParams;
  const categoryId = categories.some((row) => row.id === category) ? category : null;
  // REQ-98: archived files are hidden unless asked for.
  const showArchived = archived === "1";
  const archivedCount = files.filter((file) => file.status === "archived").length;
  const shown = showArchived ? files : files.filter((file) => file.status !== "archived");
  const found = search(fileRows(shown, categories, papers), papers, q, categoryId);
  const toggle = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(categoryId ? { category: categoryId } : {}),
    ...(showArchived ? {} : { archived: "1" }),
  }).toString();
  const toggleArchived = toggle ? `/paperwork?${toggle}` : "/paperwork";
  const searching = q.trim() !== "" || categoryId !== null;
  const fileOf = (id: string | null) => files.find((file) => file.id === id);

  return (
    <PaperworkFrame canManageMembers={canManageMembers} account={account}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="files">
          <header className={styles.head}>
            <h2 id="files" className={styles.name}>
              Search
            </h2>
            <Hint text="Find a file by its ID, label name or category, or paperwork by its name." />
          </header>
          <div className={styles.addBlock}>
            <form method="get" className={styles.form} role="search">
              <label className={styles.field}>
                <span>Search</span>
                <input name="q" defaultValue={q} placeholder="F-0042, a label or a paper's name" />
              </label>
              <label className={styles.field}>
                <span>Category</span>
                <select name="category" defaultValue={categoryId ?? ""}>
                  <option value="">All categories</option>
                  {categories.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={styles.primary}>
                Search
              </button>
              {showArchived ? <input type="hidden" name="archived" value="1" /> : null}
              {searching ? (
                <Link href={showArchived ? "/paperwork?archived=1" : "/paperwork"} className={styles.quiet}>
                  Show everything
                </Link>
              ) : null}
              {archivedCount > 0 ? (
                <Link href={toggleArchived} className={styles.quiet}>
                  {showArchived ? "Hide archived files" : `Show archived files (${archivedCount})`}
                </Link>
              ) : null}
            </form>
          </div>
          <div className={styles.entries}>
            {found.files.length === 0 ? (
              <p className={styles.empty}>{searching ? "No files match." : "No files yet."}</p>
            ) : (
              <ul className={styles.list}>
                {found.files.map(({ file, category: its, count }) => (
                  <li key={file.id} className={styles.entry}>
                    <Link href={`/paperwork/files/${file.id}`} className={local.tileLink}>
                      <span className={styles.entryHead}>
                        <span className={local.title}>{labelText(file, its)}</span>
                        <span className={styles.chip}>{count === 1 ? "1 paper" : `${count} papers`}</span>
                      </span>
                      {file.label ? <span className={styles.detail}>{file.label}</span> : null}
                      <span className={styles.detail}>{whereItIs(file, storage)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {q.trim() !== "" ? (
          <section className={styles.card} aria-labelledby="found-paperwork">
            <header className={styles.head}>
              <h2 id="found-paperwork" className={styles.name}>
                Paperwork
              </h2>
            </header>
            <div className={styles.entries}>
              {found.papers.length === 0 ? (
                <p className={styles.empty}>No paperwork matches.</p>
              ) : (
                <ul className={styles.list}>
                  {found.papers.map((paper) => {
                    const file = fileOf(paper.file_id);
                    const its = categories.find((row) => row.id === file?.category_id);
                    return (
                      <li key={paper.id} className={file ? styles.entry : styles.todo}>
                        <Link href={`/paperwork/items/${paper.id}`} className={local.tileLink}>
                          <span className={local.title}>{paper.name}</span>
                          <span className={styles.detail}>
                            {ownerName(paper, people)} · {file ? labelText(file, its) : "Unfiled"}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="new-file">
          <header className={styles.head}>
            <h2 id="new-file" className={styles.name}>
              Add files
            </h2>
            <Hint text="It gets the next ID, which never changes. Type the ID and category into your label printer." />
          </header>
          <div className={styles.addBlock}>
            {categories.length === 0 ? (
              canManagePaperwork ? (
                <Link href="/paperwork/categories" className={styles.primary}>
                  Add a category first
                </Link>
              ) : (
                <p className={`${styles.form} ${styles.empty}`}>An admin adds the categories first.</p>
              )
            ) : (
              <NewFileForm categories={categories} />
            )}
          </div>
        </section>
      </div>
    </PaperworkFrame>
  );
}
