import Link from "next/link";
import type { Module } from "../lib/modules";
import { LockIcon } from "./icons";
import styles from "./section-tabs.module.css";

// A module's sections as a row of tabs under its title, on a desktop
// (docs/design/DESIGN.md §6); a phone lists them in the Sections sheet
// instead. Overview is the module's home. Admin-only sections carry a
// lock. The pinned action (Finances: Log payment) is a button, not a tab.
// A section without a page yet is listed but can't be opened.
export function SectionTabs({ module, current }: { module: Module; current?: string }) {
  const tabClass = (here: boolean) => (here ? `${styles.tab} ${styles.current}` : styles.tab);
  return (
    <nav className={styles.tabs} aria-label={`${module.name} sections`}>
      <ul className={styles.list}>
        <li>
          <Link
            href={module.href ?? "/"}
            className={tabClass(!current)}
            aria-current={current ? undefined : "page"}
          >
            Overview
          </Link>
        </li>
        {module.sections
          .filter((section) => !section.pinned)
          .map((section) => {
            const here = current === section.name;
            const lock = section.adminOnly ? (
              <>
                <LockIcon />
                <span className={styles.hidden}>Admin only</span>
              </>
            ) : null;
            return (
              <li key={section.name}>
                {section.href ? (
                  <Link href={section.href} className={tabClass(here)} aria-current={here ? "page" : undefined}>
                    {section.name}
                    {lock}
                  </Link>
                ) : (
                  <span className={styles.tab} title="Coming soon">
                    {section.name}
                    {lock}
                  </span>
                )}
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
