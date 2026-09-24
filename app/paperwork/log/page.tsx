import styles from "../../../components/cards.module.css";
import { Hint } from "../../../components/hint";
import { householdToday } from "../../../lib/finances/budget-year";
import { LogPaperForm } from "../forms";
import { PaperworkFrame, paperworkViewer } from "../frame";

const SECTION = "Log paperwork";

// REQ-97: log paperwork as it arrives, one at a time. Left Unfiled it
// becomes Home's action item; old papers being refiled can go straight
// into a file.
export default async function LogPage() {
  const { canManageMembers, account, people, categories, files } = await paperworkViewer();

  return (
    <PaperworkFrame canManageMembers={canManageMembers} account={account} section={SECTION}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="log">
          <header className={styles.head}>
            <h2 id="log" className={styles.name}>
              Log new paperwork
            </h2>
            <Hint text="Leave the file as Unfiled and it waits on Home until someone files it." />
          </header>
          <div className={styles.addBlock}>
            <LogPaperForm people={people} files={files} categories={categories} today={householdToday()} />
          </div>
        </section>
      </div>
    </PaperworkFrame>
  );
}
