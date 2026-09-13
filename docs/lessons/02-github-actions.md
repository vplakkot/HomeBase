# Lesson 02: GitHub Actions and the pull request checks

Every pull request now runs a set of automated checks before it can be
merged. This explains what's running those checks, and what each one is
actually looking for.

## What GitHub Actions is

GitHub Actions is a robot that lives on GitHub's servers and runs commands
for you whenever something happens in the repo — like opening a pull
request. Think of it as a very literal assistant: it can't judge code
quality, but it can run the exact same commands you'd run on your own
machine (`npm test`, `npm run build`, and so on) and report back pass or
fail. The point is to catch problems automatically, on every PR, without
anyone having to remember to run the checks themselves.

The instructions for what to run live in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — a "workflow"
file. GitHub reads that file, spins up a fresh, empty Ubuntu machine,
checks out the PR's code onto it, and runs the steps listed, top to bottom.
That machine is thrown away afterward — every run starts from a truly
clean slate, which is exactly why these checks are trustworthy: there's no
leftover state from a previous run (or from someone's own laptop) that
could make a broken change look fine.

This workflow is set to trigger on `pull_request` events targeting `main`,
so it runs automatically every time a PR is opened or updated — nobody has
to remember to click a button.

## What each check catches

**Type check (`npm run typecheck`, which runs `tsc --noEmit`)**
Asks the TypeScript compiler to check every file for type errors —
wrong argument types, typos in property names, using a variable that might
be `undefined` — without actually producing any output files (that's what
`--noEmit` means; we only want the checking, not a build). Catches: a
whole class of "this would have crashed at runtime" bugs, caught instead
while writing the code.

**Test (`npm test`, which runs Vitest)**
Runs every `*.test.tsx` file in the project and checks that the assertions
in them still hold. Right now that's the one test confirming the homepage
renders "HomeBase." Catches: a change that breaks behavior we've
specifically decided matters enough to verify automatically — the check
fails the moment that behavior stops being true, instead of someone
noticing later by hand.

**Build (`npm run build`)**
Runs the exact command that would produce a production build. Catches:
things type-checking and tests can miss — for example, a page that
type-checks fine but fails during Next.js's actual page-generation step,
or a config mistake that only shows up when building for production
rather than running the dev server.

**CHANGELOG.md check**
A small script step (not a separate tool) that compares the list of files
changed between the PR's base commit and its latest commit, and fails if
`CHANGELOG.md` isn't in that list. Catches: forgetting to write down what
changed — CLAUDE.md's Definition of Done requires a CHANGELOG entry on
every PR, and this makes that a hard requirement instead of something to
remember.

## What it doesn't catch

These checks don't review code quality, naming, or whether a change is a
good idea — they only catch things that are mechanically checkable: does
it type-check, does it build, do the tests we've written still pass, was
the changelog touched. Anything more judgment-based is still a human's job.
