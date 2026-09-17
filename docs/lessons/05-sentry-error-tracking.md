# Lesson 05: Sentry error tracking

The app now reports errors — from the browser and from the server — to
Sentry. This explains what Sentry actually is, what a "DSN" is, what shows
up when an error fires, and how to remove the deliberate test errors once
you've confirmed it's working.

## What Sentry does

Right now, if something breaks for a real visitor, nobody finds out unless
that visitor happens to tell you. Sentry closes that gap: it's a service
that collects errors as they happen — in the browser, on the server,
wherever — and puts them in one dashboard with the information needed to
actually fix them: the stack trace (which line failed), what the user was
doing (which page, which browser), and how often it's happening.

Without it, you're relying on someone noticing and reporting a bug. With
it, you find out the moment it happens, with enough detail to reproduce it.

## What a DSN is

DSN stands for "Data Source Name." It's a URL, unique to your Sentry
project, that looks something like:

```
https://abc123@o000000.ingest.sentry.io/000000
```

Think of it as a mailing address: it tells the Sentry SDK running in your
app exactly which Sentry project to send error reports to. It is **not** a
secret in the usual sense — unlike an API key that grants read/write
access to your account, a DSN can only be used to *send* new error events
to one specific project. Someone with your DSN can spam your project with
fake errors, which is mildly annoying, but they can't read your data,
your other projects, or anything else in your account with it. That's why
it's safe to use as a `NEXT_PUBLIC_` environment variable here — it ends
up visible in the browser's JavaScript bundle either way, and that's fine
by design.

## What shows up when an error fires

When an error fires (the deliberate test errors described below did
exactly this to confirm the setup worked), expect a new **Issue** to
appear in the Sentry project's dashboard within a few seconds, showing:

- The error message and full stack trace, pointing at the exact file and
  line that threw
- Whether it happened in the browser or on the server (a different
  "environment"/runtime tag for each)
- The URL/route where it happened
- A count that increases if the same error happens again, instead of
  creating duplicate issues for every occurrence

Because this project skips source map upload (see "What's not included"
below), the stack trace you see in Sentry will point at built/minified
code rather than the original source lines — still enough to identify
which route or file is responsible, just less precise than it could be.

## How the pieces fit together

```mermaid
sequenceDiagram
    participant Browser
    participant Server as Next.js server
    participant Sentry

    Note over Browser: Something throws in the browser
    Browser->>Sentry: send error event (using the DSN)

    Note over Server: Something throws in a route handler
    Server->>Server: instrumentation.ts's onRequestError hook fires
    Server->>Sentry: send error event (using the same DSN)
```

Three small config files do the actual reporting:

- `instrumentation-client.ts` — initializes Sentry in the browser
- `sentry.server.config.ts` / `sentry.edge.config.ts` — initializes Sentry
  on the server (Next.js runs on two different server runtimes depending
  on the route; both need their own init)
- `instrumentation.ts` — Next.js's own hook system. It loads whichever of
  the two server configs matches the current runtime, and wires up
  `onRequestError` so that when a route handler or page throws on the
  server, Sentry hears about it automatically

## The deliberate test errors (removed)

A `/sentry-test` page briefly existed with two buttons — one throwing
directly in the browser, one calling an API route that threw on the
server — to confirm both reporting paths worked before trusting them. Both
were confirmed working (two Issues showed up correctly in Sentry's
dashboard), so the page and its route were deleted (#21) — their only job
was that one-time confirmation, and leaving a page that deliberately
crashes sitting in the app isn't something to keep around.

**If you ever need to re-test** (after a Sentry SDK upgrade, a DSN
change, or anything else that touches this setup), add it back
temporarily:

```tsx
// app/sentry-test/page.tsx
"use client";

export default function SentryTestPage() {
  return (
    <button onClick={() => { throw new Error("Sentry test"); }}>
      Throw test error
    </button>
  );
}
```

```ts
// app/api/sentry-test/route.ts
export function GET() {
  throw new Error("Sentry test: server-side");
}
```

Visit `/sentry-test` (browser case) and `/api/sentry-test` (server case),
confirm both show up in Sentry, then delete both files again.

## What's not included

**Source map upload** was left out on purpose to keep the setup minimal —
it needs an additional Sentry auth token as a secret, and its only benefit
is prettier (de-minified) stack traces in the dashboard. Errors are
reported and catchable either way; this would just make them easier to
read. Worth adding later if the minified stack traces become a real
annoyance.

**Performance monitoring** (Sentry can also track how slow requests are,
not just errors) is also not enabled — this setup only reports errors, per
what this issue asked for.
