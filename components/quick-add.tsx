"use client";

import { useState, type CSSProperties } from "react";
import { moduleBySlug, moduleColours } from "../lib/modules";
import { BottomSheet } from "./bottom-sheet";
import { PlusIcon } from "./icons";
import styles from "./quick-add.module.css";

// Adding the day's most common things without leaving Home
// (docs/design/DESIGN.md §4). A phone gets a bar fixed to the bottom of
// the screen; a desktop gets buttons at the top right. Each opens a sheet,
// and in v0.2 every sheet says the feature is coming.
const ACTIONS = [
  { label: "Expense", title: "Add an expense", module: "finances" },
  { label: "Event", title: "Add an event", module: "calendar" },
  { label: "Meal", title: "Add a meal", module: "meal-plans" },
] as const;

export function QuickAdd({ variant }: { variant: "bar" | "buttons" }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);

  return (
    <>
      <div
        role="group"
        aria-label="Quick add"
        className={variant === "bar" ? styles.bar : styles.buttons}
      >
        {ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            className={styles.action}
            style={moduleColours(moduleBySlug(action.module)) as CSSProperties}
            onClick={() => setOpenLabel(action.label)}
          >
            <span className={styles.chip} aria-hidden="true">
              <PlusIcon size={variant === "bar" ? 16 : 14} />
            </span>
            {action.label}
          </button>
        ))}
      </div>
      {ACTIONS.map((action) => (
        <BottomSheet
          key={action.label}
          open={openLabel === action.label}
          onClose={() => setOpenLabel(null)}
          title={action.title}
        >
          <p className={styles.soon}>
            Coming soon. Adding from Home arrives with the {moduleBySlug(action.module).name} module.
          </p>
        </BottomSheet>
      ))}
    </>
  );
}
