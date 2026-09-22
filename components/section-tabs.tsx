import Link from "next/link";
import type { Module } from "../lib/modules";
import { LockIcon } from "./icons";
import styles from "./section-tabs.module.css";

// A module's sections as a row of tabs under its title, on a desktop
// (docs/design/DESIGN.md §6); a phone lists them in the Sections sheet
// instead. Overview is the module's home. Admin-only sections carry a
// lock. The pinned action (Finances: Log payment) is a button, not a tab.
// In v0.2 no section has a page yet, so only Overview can be opened.
export function SectionTabs({ module }: { module: Module }) {
  return (
    <nav className={styles.tabs} aria-label={`${module.name} sections`}>
      <ul className={styles.list}>
        <li>
          <Link
            href={module.href ?? "/"}
            className={`${styles.tab} ${styles.current}`}
            aria-current="page"
          >
            Overview
          </Link>
        </li>
        {module.sections
          .filter((section) => !section.pinned)
          .map((section) => (
            <li key={section.name}>
              <span className={styles.tab} title="Coming soon">
                {section.name}
                {section.adminOnly ? (
                  <>
                    <LockIcon />
                    <span className={styles.hidden}>Admin only</span>
                  </>
                ) : null}
              </span>
            </li>
          ))}
      </ul>
    </nav>
  );
}
