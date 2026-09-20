# Lesson 04: Build-time environment variables and showing the running version

The homepage now shows a small line at the bottom — something like
`main · a1b2c3d` — naming the git branch/tag and commit that produced the
page you're looking at. This explains what makes that possible, and why
it's worth having.

## What a "build-time" environment variable is

An environment variable is just a named value handed to a program from
outside its own code — not hardcoded, not typed in, just present in the
environment the program runs in. `process.env.SOMETHING` reads it.

"Build-time" specifies *when* that value gets read. This app is mostly
static: `npm run build` runs once, produces finished HTML, and that HTML
is what gets served afterward (see
[lesson 01](01-blank-app.md) on Server Components). Any `process.env`
lookup inside `app/page.tsx` happens during that one build step — the
value gets baked into the generated HTML. It is not re-read on every
visit. If the value changes, the page doesn't know until the next build.

This matters because it explains the behavior you'd see testing this
locally: running `npm run dev` shows `dev · local` (the fallback text),
because your laptop's environment doesn't have Vercel's variables set.
Only an actual Vercel build has them.

## Where the values come from

Vercel automatically sets a handful of environment variables during every
build it runs — things like which commit triggered it. Two are used here:

- `VERCEL_GIT_COMMIT_REF` — the branch or tag name associated with the
  build
- `VERCEL_GIT_COMMIT_SHA` — the exact commit hash built (shown shortened,
  first 7 characters, the way `git log --oneline` does)

These aren't set by default just because a project deploys on Vercel —
there's a toggle in Project Settings → Environment Variables called
"Automatically expose System Environment Variables" that has to be turned
on. Without it, both variables come back empty and the page falls back to
its placeholder text.

## A limitation worth knowing about

Because of the [promote-on-tag pipeline](03-tags-releases-promote.md) this
project uses, `VERCEL_GIT_COMMIT_REF` will usually read `main`, not the
release tag like `v0.0.3`. That's because Vercel builds the app the moment
a PR merges to `main` — before any tag exists. The tag only decides
*when that already-built code* gets promoted to a custom production
domain (there is none yet — see [lesson 03](03-tags-releases-promote.md)
and [issue #81](https://github.com/vplakkot/HomeBase/issues/81)); it
never triggers a new build. So "version" here really means "which branch
built this," not "which release this is." The commit hash is still exact
and reliable, though — it names precisely which code is running, which is
the part that actually matters for verifying a deploy.

## Why this matters for verifying deploys

Without something like this, "is the site showing the latest code?" is a
guess — you'd have to trust that a merge or promote succeeded. With the
commit hash on the page, it's a direct check: open the site, look at the
bottom, compare that hash to `git log` or the PR you just merged. If they
match, that exact code is what's live. If they don't, something in the
pipeline didn't do what was expected — and now that's visible in seconds
instead of being a mystery.
