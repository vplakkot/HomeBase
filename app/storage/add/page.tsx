import styles from "../../../components/cards.module.css";
import { Hint } from "../../../components/hint";
import { EntryForm } from "../forms";
import { StorageFrame, storageViewer } from "../frame";

const SECTION = "Add an entry";

// REQ-87: add a box or a loose item. Saving opens its page, which shows
// the new ID for the label printer.
export default async function AddPage() {
  const { canManageMembers, account } = await storageViewer();

  return (
    <StorageFrame canManageMembers={canManageMembers} account={account} section={SECTION}>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="add">
          <header className={styles.head}>
            <h2 id="add" className={styles.name}>
              Add an entry
            </h2>
            <Hint text="It gets the next ID, which never changes. Labels only need to go on boxes." />
          </header>
          <div className={styles.addBlock}>
            <EntryForm />
          </div>
        </section>
      </div>
    </StorageFrame>
  );
}
