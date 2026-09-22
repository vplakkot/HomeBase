"use client";

import { useState, type CSSProperties, type UIEvent } from "react";
import type { ActionItem } from "../lib/module-status";
import { moduleColours, type Module } from "../lib/modules";
import { AllClear } from "./all-clear";
import { ChevronRightIcon, MODULE_ICONS } from "./icons";
import { SectionLabel } from "./section-label";
import styles from "./action-items.module.css";

export type HomeActionItem = { module: Module; item: ActionItem };

// The things that need someone, at the top of Home (docs/design/DESIGN.md
// §5), already cut to the three most urgent. None: the All clear row.
//
// It's one list either way, and the screen width lays it out. On a phone
// the list scrolls sideways and snaps to one card at a time, so a swipe
// moves between them; the "1 / 3" counter, the dots and the stacked edges
// follow whichever card is showing. On a desktop the same cards sit side
// by side. Nothing moves unless someone swipes: the card never rotates on
// its own.
//
// In v0.2 the cards don't open anything: deep links need the screens
// they'd open, which come later.
export function ActionItems({ labelId, items }: { labelId: string; items: HomeActionItem[] }) {
  const [current, setCurrent] = useState(0);
  const count = items.length;
  const stacked = count > 1;
  const behind = stacked ? Math.min(count - 1 - current, 2) : 0;

  function followScroll(event: UIEvent<HTMLUListElement>) {
    const list = event.currentTarget;
    if (list.clientWidth === 0) return;
    const index = Math.round(list.scrollLeft / list.clientWidth);
    setCurrent(Math.max(0, Math.min(index, count - 1)));
  }

  return (
    <>
      <div className={styles.labelRow}>
        <SectionLabel id={labelId}>Action items</SectionLabel>
        {stacked ? (
          <span className={styles.counter}>
            {current + 1} / {count}
          </span>
        ) : null}
        {count > 0 ? <span className={styles.total}>· {count}</span> : null}
      </div>

      {count === 0 ? (
        <AllClear />
      ) : (
        <>
          <div className={stacked ? `${styles.stack} ${styles.stacked}` : styles.stack}>
            {behind >= 2 ? <span className={styles.edgeFar} aria-hidden="true" /> : null}
            {behind >= 1 ? <span className={styles.edgeNear} aria-hidden="true" /> : null}
            <ul
              className={styles.cards}
              onScroll={stacked ? followScroll : undefined}
              // A list that scrolls sideways needs to take keyboard focus,
              // so the arrow keys can move through it too.
              tabIndex={stacked ? 0 : undefined}
              aria-labelledby={labelId}
            >
              {items.map(({ module, item }) => (
                <li key={`${module.slug}-${item.rank}`} className={styles.item}>
                  <Card module={module} item={item} />
                </li>
              ))}
            </ul>
          </div>
          {stacked ? (
            <div className={styles.dots} aria-hidden="true">
              {items.map(({ module, item }, index) => (
                <span
                  key={`${module.slug}-${item.rank}`}
                  className={index === current ? `${styles.dot} ${styles.dotOn}` : styles.dot}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

// One item: the module's icon on its loud colour, a line of text, a line
// of detail and a chevron. No module name; the icon says which it is.
function Card({ module, item }: HomeActionItem) {
  const Icon = MODULE_ICONS[module.slug];
  return (
    <div className={styles.card} style={moduleColours(module) as CSSProperties}>
      <span className={styles.chip} aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{item.text}</span>
        <span className={styles.detail}>{item.detail}</span>
      </span>
      <span className={styles.go} aria-hidden="true">
        <ChevronRightIcon />
      </span>
    </div>
  );
}
