import { CheckIcon } from "./icons";
import styles from "./all-clear.module.css";

// What Home shows where action items go when there are none
// (docs/design/DESIGN.md §5). A calm day should look calm.
export function AllClear() {
  return (
    <div className={styles.row}>
      <span className={styles.chip} aria-hidden="true">
        <CheckIcon />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>All clear</span>
        <span className={styles.note}>No action items today</span>
      </span>
    </div>
  );
}
