import { notFound } from "next/navigation";
import styles from "../../../../components/cards.module.css";
import { Hint } from "../../../../components/hint";
import { householdToday } from "../../../../lib/finances/budget-year";
import { removePaper } from "../../actions";
import { PaperForm } from "../../forms";
import { PaperworkFrame, paperworkViewer } from "../../frame";

// One paper (REQ-97): change any of its fields, move it to another file
// or back to Unfiled, or remove it.
export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { canManageMembers, account, people, categories, files, papers } = await paperworkViewer();
  const paper = papers.find((row) => row.id === id);
  if (!paper) notFound();

  return (
    <PaperworkFrame canManageMembers={canManageMembers} account={account} section={paper.name}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="paper">
          <header className={styles.head}>
            <h2 id="paper" className={styles.name}>
              {paper.name}
            </h2>
            <Hint text={`Logged ${paper.logged_on}. Change its file to move it, or choose Unfiled.`} />
          </header>
          <div className={styles.addBlock}>
            <PaperForm people={people} files={files} categories={categories} today={householdToday()} paper={paper} />
            <form action={removePaper} className={styles.form}>
              <input type="hidden" name="id" value={paper.id} />
              <button type="submit" className={styles.quiet} aria-label={`Remove ${paper.name}`}>
                Remove the paperwork
              </button>
            </form>
          </div>
        </section>
      </div>
    </PaperworkFrame>
  );
}
