import Link from "next/link";
import styles from "../../../components/cards.module.css";
import { Hint } from "../../../components/hint";
import { ownerName, unfiled } from "../../../lib/paperwork/paperwork";
import { FileItForm } from "../forms";
import { PaperworkFrame, paperworkViewer } from "../frame";
import local from "../page.module.css";

const SECTION = "Unfiled";

// REQ-97: paperwork waiting for a file, which is where Home's "N unfiled
// paperwork" item leads. Filing one is the "done": it drops off here and
// off Home's count.
export default async function UnfiledPage() {
  const { canManageMembers, account, people, categories, files, papers } = await paperworkViewer();
  const waiting = unfiled(papers);

  return (
    <PaperworkFrame canManageMembers={canManageMembers} account={account} section={SECTION}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="unfiled">
          <header className={styles.head}>
            <h2 id="unfiled" className={styles.name}>
              {waiting.length === 1 ? "1 unfiled" : `${waiting.length} unfiled`}
            </h2>
            <Hint text="Put each one in a file, or make a new file for it." />
          </header>
          <div className={styles.entries}>
            {waiting.length === 0 ? (
              <p className={styles.empty}>Everything is filed.</p>
            ) : (
              <ul className={styles.list}>
                {waiting.map((paper) => (
                  <li key={paper.id} className={styles.todo}>
                    <Link href={`/paperwork/items/${paper.id}`} className={local.tileLink}>
                      <span className={local.title}>{paper.name}</span>
                      <span className={styles.detail}>
                        {ownerName(paper, people)} · Logged {paper.logged_on}
                      </span>
                    </Link>
                    {categories.length === 0 ? null : (
                      <FileItForm paper={paper} files={files} categories={categories} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </PaperworkFrame>
  );
}
