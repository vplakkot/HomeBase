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
