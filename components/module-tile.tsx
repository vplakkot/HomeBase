import Link from "next/link";
import type { CSSProperties } from "react";
import { isLoud, type ModuleStatus } from "../lib/module-status";
import { moduleColours, type Module } from "../lib/modules";
import { ChevronRightIcon, MODULE_ICONS } from "./icons";
import styles from "./module-tile.module.css";

// A module on Home (docs/design/DESIGN.md §4): its icon in a round chip,
// its name, then one line of status on a phone, or a headline and two
// facts on a desktop. It's loud, in the module's solid colour, only while
// the module has an action item; otherwise quiet. The whole tile is one
// link to the module, if the module has pages; in v0.2 only Finances
// does, so the rest are shown without a link or an arrow.
export function ModuleTile({ module, status }: { module: Module; status: ModuleStatus }) {
  const Icon = MODULE_ICONS[module.slug];
  const colours = moduleColours(module) as CSSProperties;
  const className = isLoud(status) ? `${styles.tile} ${styles.loud}` : styles.tile;
  const content = (
    <>
      <span className={styles.chip} aria-hidden="true">
        <Icon />
      </span>
      <span className={styles.name}>{module.name}</span>
      <span className={styles.status}>{status.status}</span>
      <span className={styles.headline}>{status.headline}</span>
      {status.facts.length > 0 ? (
        <span className={styles.facts}>
          {status.facts.map((fact) => (
            <span key={fact.label} className={styles.fact}>
              <span>{fact.label}</span>
              <span className={styles.value}>{fact.value}</span>
            </span>
          ))}
        </span>
      ) : null}
    </>
  );

  if (!module.href) {
    return (
      <div className={className} style={colours}>
        {content}
      </div>
    );
  }
  return (
    <Link href={module.href} className={className} style={colours}>
      {content}
      <span className={styles.go} aria-hidden="true">
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
