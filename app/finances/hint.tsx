import { InfoIcon } from "../../components/icons";
import styles from "./budget-year/page.module.css";

// A card's explanation, kept on an info icon so the card's head stays one
// line (#133): shown on hover or focus, and read out as a note.
export function Hint({ text }: { text: string }) {
  return (
    <span className={styles.info} data-hint={text} title={text} tabIndex={0} role="note" aria-label={text}>
      <InfoIcon />
    </span>
  );
}
