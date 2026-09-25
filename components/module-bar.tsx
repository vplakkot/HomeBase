"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { MODULES, moduleColours, type Module } from "../lib/modules";
import { BottomSheet } from "./bottom-sheet";
import { HomeIcon, ModulesIcon, SectionsIcon } from "./icons";
import styles from "./module-bar.module.css";

// The bar fixed to the bottom of a phone screen inside a module: exactly
// Home, Sections and Modules, the same in every module
// (docs/design/DESIGN.md §6). Sections shows as selected while you're on
// the module's own home; `current` names the section page you're on. A
// module's pinned action (Finances: Log payment) sits just above the bar.
// `pinnedHref` points the pinned action somewhere else (Finances: the
// month you're looking at), and null leaves it out (a closed month).
export function ModuleBar({
  module,
  current,
  pinnedHref,
}: {
  module: Module;
  current?: string;
  pinnedHref?: string | null;
}) {
  const [sheet, setSheet] = useState<"sections" | "modules" | null>(null);
  const close = () => setSheet(null);
  const pinned = pinnedHref === null ? undefined : module.sections.find((section) => section.pinned && section.href);

  return (
    <>
      {pinned?.href && current !== pinned.name ? (
        <div className={styles.pinnedRow} style={moduleColours(module) as CSSProperties}>
          <Link href={pinnedHref ?? pinned.href} className={styles.pinned}>
            {pinned.name}
          </Link>
        </div>
      ) : null}
      <nav aria-label={`${module.name} navigation`} className={styles.bar} style={moduleColours(module) as CSSProperties}>
        <Link href="/" className={styles.item}>
          <HomeIcon />
          Home
        </Link>
        <button
          type="button"
          className={`${styles.item} ${styles.selected}`}
          onClick={() => setSheet("sections")}
        >
          <SectionsIcon />
          Sections
        </button>
        <button
          type="button"
          className={styles.item}
          aria-label="Other modules"
          onClick={() => setSheet("modules")}
        >
          <ModulesIcon />
        </button>
      </nav>

      <BottomSheet open={sheet === "sections"} onClose={close} title={module.name}>
        {/* The sheet sits outside the bar, so it needs the colours too. */}
        <ul className={styles.list} style={moduleColours(module) as CSSProperties}>
          <li>
            <Link
              href={module.href ?? "/"}
              className={styles.row}
              aria-current={current ? undefined : "page"}
              onClick={close}
            >
              <span className={styles.rowName}>Overview</span>
            </Link>
          </li>
          {module.sections.filter((section) => !section.hidden).map((section) => {
            const text = (
              <>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{section.name}</span>
                  <span className={styles.rowNote}>{section.description}</span>
                </span>
                {section.adminOnly ? <span className={styles.chip}>Admin only</span> : null}
              </>
            );
            return (
              <li key={section.name}>
                {section.href ? (
                  <Link
                    href={section.href}
                    className={styles.row}
                    aria-current={current === section.name ? "page" : undefined}
                    onClick={close}
                  >
                    {text}
                  </Link>
                ) : (
                  <span className={styles.row}>
                    {text}
                    <span className={styles.chip}>Coming soon</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </BottomSheet>

      <BottomSheet open={sheet === "modules"} onClose={close} title="Modules">
        <ul className={styles.list}>
          {MODULES.map((other) => (
            <li key={other.slug} style={moduleColours(other) as CSSProperties}>
              {other.href ? (
                <Link
                  href={other.href}
                  className={styles.row}
                  aria-current={other.slug === module.slug ? "page" : undefined}
                  onClick={close}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.rowName}>{other.name}</span>
                </Link>
              ) : (
                <span className={styles.row}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={`${styles.rowName} ${styles.soon}`}>{other.name}</span>
                  <span className={styles.chip}>Coming soon</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
