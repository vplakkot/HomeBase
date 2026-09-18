const PUBLIC_PATHS = ["/sign-in", "/sign-up"];

export const SET_PASSWORD_PATH = "/set-password";

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

// Where a request should be sent instead, or null to let it through.
export function redirectFor(
  pathname: string,
  signedIn: boolean,
  mustSetPassword = false,
): string | null {
  if (!signedIn) {
    return isPublic(pathname) ? null : "/sign-in";
  }
  if (mustSetPassword) {
    return pathname === SET_PASSWORD_PATH ? null : SET_PASSWORD_PATH;
  }
  if (isPublic(pathname) || pathname === SET_PASSWORD_PATH) {
    return "/";
  }
  return null;
}
