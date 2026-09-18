const PUBLIC_PATHS = ["/sign-in", "/sign-up"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

// Where a request should be sent instead, or null to let it through.
export function redirectFor(pathname: string, signedIn: boolean): string | null {
  if (!signedIn && !isPublic(pathname)) {
    return "/sign-in";
  }
  if (signedIn && isPublic(pathname)) {
    return "/";
  }
  return null;
}
