import Link from "next/link";
import type { CSSProperties } from "react";
import { moduleColours, type Module } from "../lib/modules";
import { ChevronRightIcon, MODULE_ICONS } from "./icons";
import styles from "./module-tile.module.css";

// A module on Home (docs/design/DESIGN.md §4): its icon in a round chip,
// its name and one line of status, in the module's quiet colours. The
// whole tile is one link to the module, if the module has pages; in v0.2
// only Finances does, so the rest are shown without a link or an arrow.
export function ModuleTile({ module, status }: { module: Module; status: string }) {
  const Icon = MODULE_ICONS[module.slug];
  const colours = moduleColours(module) as CSSProperties;
  const content = (
    <>
      <span className={styles.chip} aria-hidden="true">
        <Icon />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{module.name}</span>
        <span className={styles.status}>{status}</span>
      </span>
    </>
  );

  if (!module.href) {
    return (
      <div className={styles.tile} style={colours}>
        {content}
      </div>
    );
  }
  return (
    <Link href={module.href} className={styles.tile} style={colours}>
      {content}
      <span className={styles.go} aria-hidden="true">
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
