import type { Ingredient } from "./recipes";

// Editing a recipe's lists (REQ-181): rows that move up and down with
// arrows, and the steps to look at again when an ingredient's amount changes.

export function moveRow<T>(rows: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// The words a step might use for an ingredient: its whole name, or its
// last word ("ground cumin" is often just "cumin" in a step).
function names(item: string): string[] {
  const whole = item.trim().toLowerCase();
  const last = whole.split(/\s+/).pop() ?? "";
  return [...new Set([whole, last.length >= 3 ? last : ""])].filter(Boolean);
}

// An ingredient whose amount or unit differs from what was saved.
export function amountChanged(now: Ingredient, was: Ingredient | undefined): boolean {
  return was !== undefined && (now.quantity.trim() !== was.quantity || now.unit.trim() !== was.unit);
}

// Which steps (by position) mention an ingredient whose amount changed.
export function stepsToCheck(steps: string[], changed: Ingredient[]): Set<number> {
  const found = new Set<number>();
  const wanted = changed.flatMap((ingredient) => names(ingredient.item));
  steps.forEach((step, index) => {
    const lower = step.toLowerCase();
    if (wanted.some((name) => lower.includes(name))) found.add(index);
  });
  return found;
}
