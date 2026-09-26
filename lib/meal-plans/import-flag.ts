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

export function forgetImports() {
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
