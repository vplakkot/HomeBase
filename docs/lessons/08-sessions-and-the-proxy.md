# Lesson 08: Sessions, cookies, and the doorman in front of every page

REQ-11 ("sign in and sign out with password") is small in lines of code
and large in ideas: what a session is, why it lives in a cookie, and why
one file now runs *before* every page in the app.

## What signing in actually produces

When `signInWithPassword()` succeeds, Supabase hands back two tokens:

- an **access token** — a signed statement ("this is user X, valid until
  T") the app can check without asking Supabase;
- a **refresh token** — used to get a new access token when the old one
  expires, so nobody has to type their password again.

`@supabase/ssr` stores both in cookies. Cookies are the right place for a
server-rendered app: every request the browser makes carries them
automatically, so a page rendering on the server knows who is asking. And
because they're ordinary cookies with an expiry, they survive closing the
browser or the installed app — which is the whole of the "still signed in
when I reopen it" acceptance criterion.

Analogy: the access token is a day pass with a hologram; the refresh
token is your membership card, kept in the same wallet (the cookie jar),
which gets you a new day pass without re-registering.

## The doorman: `proxy.ts`

[`proxy.ts`](../../proxy.ts) at the repo root is Next.js's hook for
running code before a request reaches any page (Next 16 renamed this from
`middleware.ts`; the old name still works but is deprecated). Ours does
two jobs on every request:

1. **Refresh the session.** It builds a Supabase client from the request's
   cookies and calls `getClaims()`. If the access token is about to
   expire, the library uses the refresh token to get a new one and hands
   the new cookies back; the proxy writes them onto both the request (so
   the page about to render sees them) and the response (so the browser
   keeps them).
2. **Decide whether you may go in.** Signed out and asking for anything
   but `/sign-in` or `/sign-up`? Redirected to `/sign-in`. Signed in and
   asking for those two? Sent home. That rule is a pure function in
   [`lib/auth/routing.ts`](../../lib/auth/routing.ts), so it's unit-tested
   without a server.

### Why `getClaims()` and not `getSession()`

`getSession()` reads the cookie and believes it. `getClaims()` checks the
token's signature against Supabase's public signing key. The difference
matters precisely here, at the boundary, because the cookie comes from
the browser and a browser can send anything. A forged cookie would sail
past `getSession()`; it fails the signature check in `getClaims()`. The
doorman checks the hologram, not just that you're holding a card.

### The matcher, and one thing it can't promise

`export const config = { matcher: [...] }` stops the proxy running for
static files (`_next/static`, images), which need no auth and shouldn't
pay for a token check. Next's docs add a warning worth remembering:
Server Functions are POSTs to the page they're used on, so a path the
matcher excludes also skips the proxy for those calls. That is why the
home page does its own `getClaims()` check and redirects if there's no
user — belt and braces, and cheap.

## One error message for every sign-in failure

A wrong password and an unknown email both produce "Email or password is
incorrect." — deliberately. If the message differed ("no account with
that email"), anyone could type addresses into the form to learn who has
an account. Supabase's own message is already generic; the action still
replaces it, so a future change on their side can't leak by accident.

## Devices are independent

Each sign-in gets its own refresh token, so signing in on the phone does
nothing to the laptop's session. Two settings decide this:

- In Supabase, Authentication → Sessions → **"Enforce single session per
  user"** must stay **off** (it is).
- Sign-out calls `signOut({ scope: "local" })`. The default scope is
  `"global"`, which revokes *every* session that person has — surprising
  behaviour for "sign out of this laptop". Local ends this device only.

## Verifying it

Locally: sign in as the test admin, land on `/`; try a wrong password and
see the generic message; sign out and try `/` — bounced to `/sign-in`.
Two devices: sign in from two different browsers (they don't share
cookies) and confirm the first stays signed in after the second signs in.
Persistence: the `sb-*` cookies carry a `Max-Age`, so they outlive a
browser restart; the installed-iPhone version of that check belongs with
REQ-19, which makes the app installable.
