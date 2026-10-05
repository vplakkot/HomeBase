"use client";

import { useState, type CSSProperties } from "react";
import { PlanAheadForm, StartPlanForm } from "../app/meal-plans/plan-forms";
import { moduleBySlug, moduleColours } from "../lib/modules";
import { BottomSheet } from "./bottom-sheet";
import { PlusIcon } from "./icons";
import styles from "./quick-add.module.css";

// Adding the day's most common things without leaving Home
// (docs/design/DESIGN.md §4). A phone gets a bar fixed to the bottom of
// the screen; a desktop gets buttons at the top right. Each opens a sheet.
// New meal plan starts a plan there (REQ-118), or plans ahead while one
// is running (REQ-162) and is gone once both exist; the others say the
// feature is coming.
export type PlanAction = "new" | "ahead" | null;

const ACTIONS = [
  { label: "Expense", title: "Add an expense", module: "finances" },
  { label: "Event", title: "Add an event", module: "calendar" },
  { label: "New meal plan", title: "Start a meal plan", module: "meal-plans" },
] as const;

// `off`: modules the household has turned off, whose actions go too
// (REQ-141).
export function QuickAdd({
  variant,
  today,
  off = [],
  planAction = "new",
}: {
  variant: "bar" | "buttons";
  today: string;
  off?: readonly string[];
  planAction?: PlanAction;
}) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const actions = ACTIONS.filter((action) => !off.includes(action.module) && (action.module !== "meal-plans" || planAction !== null)).map((action) =>
    action.module === "meal-plans" && planAction === "ahead" ? { ...action, label: "Plan next week", title: "Plan next week" } : action,
  );

  return (
    <>
      <div
        role="group"
        aria-label="Quick add"
        className={variant === "bar" ? styles.bar : styles.buttons}
      >
        {actions.map((action) => (
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
      {actions.map((action) => (
        <BottomSheet
          key={action.label}
          open={openLabel === action.label}
          onClose={() => setOpenLabel(null)}
          title={action.title}
        >
          {action.module === "meal-plans" ? (
            // With a plan running this queues the next one behind it.
            planAction === "ahead" ? <PlanAheadForm thenWeek /> : <StartPlanForm today={today} label="New meal plan" thenWeek />
          ) : (
            <p className={styles.soon}>
              Coming soon. Adding from Home arrives with the {moduleBySlug(action.module).name} module.
            </p>
          )}
        </BottomSheet>
      ))}
    </>
  );
}
