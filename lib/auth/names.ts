// REQ-124: a person's display name, as they or an admin type it. Spaces
// round it are dropped and runs of spaces become one; an empty name isn't
// a name, and a person without one is shown by their email, as before.
// 50 characters is plenty for a name and still fits a row on a phone
// (REQ-124 left the limit open; set here on 2026-09-27).
export const NAME_MAX = 50;

export function cleanName(typed: unknown): string | null {
  if (typeof typed !== "string") return null;
  const name = typed.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= NAME_MAX ? name : null;
}
