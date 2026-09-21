import Link from "next/link";
import styles from "./admin-pill.module.css";

// The way into the admin console on phone Home (docs/design/DESIGN.md §4).
// Only admins should be shown it, and the page it opens checks the
// permission again for itself, so hiding the pill is a courtesy, not the
// lock.
export function AdminPill() {
  return (
    <Link href="/admin" className={styles.pill}>
      Admin
    </Link>
  );
}
