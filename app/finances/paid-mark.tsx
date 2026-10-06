import styles from "./page.module.css";

// "Paid" with a dark green tick in a rounded square beside it (Vin chose this
// shape over a plain tick, a solid circle and a ring, 2026-10-06). The word
// stays, so the tick is only decoration.
export function Paid() {
  return (
    <span className={styles.paid}>
      Paid
      <svg className={styles.paidTick} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <rect className={styles.paidBox} x="1.5" y="1.5" width="21" height="21" rx="6" />
        <path className={styles.paidCheck} d="M6.8 12.6l3.6 3.6 6.8-7.2" />
      </svg>
    </span>
  );
}
