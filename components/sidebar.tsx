import Link from "next/link";
import type { CSSProperties } from "react";
import { MODULES, moduleColours } from "../lib/modules";
import { BrandLockup } from "./brand-lockup";
import { AdminConsoleIcon, HomeIcon } from "./icons";
import { SectionLabel } from "./section-label";
import styles from "./sidebar.module.css";

// Where you are: Home, the admin console, or a module by its slug.
export type Place = "home" | "admin" | (string & {});

// Desktop navigation (docs/design/DESIGN.md §4): the brand, Home, every
// module, and the admin console for admins. Below 1024 px it isn't shown;
// phones get Home's tiles and the bars at the bottom of the screen.
export function Sidebar({ current, canAdminister }: { current: Place; canAdminister: boolean }) {
  return (
    <nav aria-label="Main" className={styles.sidebar}>
      <div className={styles.brand}>
        <BrandLockup />
      </div>
      <Link
        href="/"
        className={styles.row}
        aria-current={current === "home" ? "page" : undefined}
      >
        <HomeIcon size={18} />
        Home
      </Link>
      <div className={styles.modules}>
        <SectionLabel>Modules</SectionLabel>
        <ul className={styles.list}>
          {MODULES.map((module) => (
            <li key={module.slug} style={moduleColours(module) as CSSProperties}>
              {module.href ? (
                <Link
                  href={module.href}
                  className={`${styles.row} ${styles.module}`}
                  aria-current={current === module.slug ? "page" : undefined}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  {module.name}
                </Link>
              ) : (
                // Listed so the household sees what's coming, but not a
                // link: v0.2 opens only Finances.
                <span className={`${styles.row} ${styles.module} ${styles.soon}`}>
                  <span className={styles.dot} aria-hidden="true" />
                  {module.name}
                  <span className={styles.hidden}>, coming soon</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {canAdminister ? (
        <Link
          href="/admin"
          className={`${styles.row} ${styles.bottom}`}
          aria-current={current === "admin" ? "page" : undefined}
        >
          <AdminConsoleIcon />
          Admin console
        </Link>
      ) : null}
    </nav>
  );
}
