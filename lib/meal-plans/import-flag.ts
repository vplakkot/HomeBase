// A note in this browser that one of its recipe imports may still be
// going, so the "Recipe ready" toast only asks the server when there's
// something to ask about. Losing the note (a private window, cleared
// data) only means the toast waits until the Meal Plan overview shows it.
const KEY = "homebase:recipe-imports";

export function rememberImports() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {}
}

// REQ-166: notes dismissed in this tab, remembered across pages (each page
// has its own toast) until the tab has nothing left to show.
const dismissed = new Set<string>();

export function dismissNote(id: string) {
  dismissed.add(id);
}

export function noteDismissed(id: string): boolean {
  return dismissed.has(id);
}

// REQ-167: the Meal Plan pages are drawn by the server once, so the "On
// their way" list can't change by itself. The toast is what keeps asking;
// when what it hears differs from last time, it says so with this event, and
// whichever Meal Plan page is open redraws itself (import-watch.tsx).
export const IMPORTS_CHANGED = "homebase:imports-changed";

export function announceImportsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(IMPORTS_CHANGED));
}

export function forgetImports() {
  dismissed.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function importsRemembered(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
