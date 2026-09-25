import Link from "next/link";
import type { Module } from "../lib/modules";
import { LockIcon } from "./icons";
import styles from "./section-tabs.module.css";

// A module's sections as a row of tabs under its title, on a desktop
// (docs/design/DESIGN.md §6); a phone lists them in the Sections sheet
// instead. Overview is the module's home. Admin-only sections carry a
// lock. The pinned action (Finances: Log payment) is a button at the end
// of the row, not a tab. A section without a page yet is listed but
// can't be opened. A module whose header carries the pinned action
// (Finances, DESIGN.md §7) leaves it out here. Looking at a month other
// than this one, the month's pages keep it (`month`, as 2026-08).
export function SectionTabs({
  module,
  current,
  month,
  pinnedInHeader = false,
}: {
  module: Module;
  current?: string;
  month?: string;
  pinnedInHeader?: boolean;
}) {
  const tabClass = (here: boolean) => (here ? `${styles.tab} ${styles.current}` : styles.tab);
  const pinned = pinnedInHeader ? undefined : module.sections.find((section) => section.pinned && section.href);
  const hrefOf = (href: string, monthly?: boolean) => (month && monthly ? `${href}?month=${month}` : href);
  return (
    <nav className={styles.tabs} aria-label={`${module.name} sections`}>
      <ul className={styles.list}>
        <li>
          <Link
            href={hrefOf(module.href ?? "/", true)}
            className={tabClass(!current)}
            aria-current={current ? undefined : "page"}
          >
            Overview
          </Link>
        </li>
        {module.sections
          .filter((section) => !section.pinned && !section.hidden)
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
                  <Link href={hrefOf(section.href, section.monthly)} className={tabClass(here)} aria-current={here ? "page" : undefined}>
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
        {pinned?.href ? (
          <li className={styles.pinnedItem}>
            <Link
              href={pinned.href}
              className={styles.pinned}
              aria-current={current === pinned.name ? "page" : undefined}
            >
              {pinned.name}
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
