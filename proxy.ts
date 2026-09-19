import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { redirectFor } from "./lib/auth/routing";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers ?? {})) {
          response.headers.set(name, value);
        }
      },
    },
  });

  // getClaims() verifies the token's signature; getSession() would trust
  // whatever the cookie claims, which is exactly what a forged cookie wants.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const mustSetPassword = claims?.app_metadata?.must_set_password === true;
  const target = redirectFor(
    request.nextUrl.pathname,
    Boolean(claims),
    mustSetPassword,
  );
  if (!target) {
    return response;
  }

  const redirect = NextResponse.redirect(new URL(target, request.url));
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  for (const name of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(name);
    if (value) {
      redirect.headers.set(name, value);
    }
  }
  return redirect;
}

// The proxy skips files that hold nothing private and that a browser or
// phone fetches on its own. The web app manifest is one of them: phones
// fetch it without the sign-in cookies, so if it came through here it would
// be answered with the sign-in page and "Add to Home Screen" would ignore
// it. The icons it names are PNGs, which the extension rule already skips.
// The service worker (sw.js) is the other: the phone re-checks it in the
// background, and a service worker that answers with a redirect is refused
// outright, so a lapsed sign-in must never turn into one.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest$|sw\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
