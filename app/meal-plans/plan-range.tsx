import { dayLabel, planEnd, type Meal, type MealKind } from "../../lib/meal-plans/meals";
import type { MealPlan } from "../../lib/meal-plans/plan";
import styles from "./meal-plans.module.css";

// REQ-171: a plan's dates in one short line: "Sun, Oct 4 Dinner – Mon, Oct 5
// Lunch", the first meal and the last filled one, each date with a small
// Dinner or Lunch marker in the same style. A plan that fits in one meal
// shows its date once.
const MARK: Record<MealKind, string> = { lunch: "Lunch", dinner: "Dinner" };

function RangeDate({ at }: { at: Meal }) {
  return (
    <span>
      {dayLabel(at.day)} <small className={styles.rangeMark}>{MARK[at.meal]}</small>
    </span>
  );
}

export function PlanRange({ plan }: { plan: Pick<MealPlan, "starts_on" | "starts_meal" | "recipes"> }) {
  const start: Meal = { day: plan.starts_on, meal: plan.starts_meal };
  const end = planEnd(plan.recipes);
  const same = !end || (end.day === start.day && end.meal === start.meal);
  return same ? (
    <RangeDate at={start} />
  ) : (
    <>
      <RangeDate at={start} /> – <RangeDate at={end} />
    </>
  );
}
