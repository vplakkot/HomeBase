export const MODE_COOKIE = "homebase-mode";

export type Mode = "member" | "admin";

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export function readMode(cookies: CookieReader): Mode {
  return cookies.get(MODE_COOKIE)?.value === "admin" ? "admin" : "member";
}
