import type { ReactNode } from "react";
import styles from "./section-label.module.css";

// The small uppercase heading above a group, like ACTION ITEMS or MODULES
// (docs/design/DESIGN.md §2). It's a real heading, so a screen reader can
// jump between groups, just styled small.
export function SectionLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className={styles.label}>
      {children}
    </h2>
  );
}
