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

## The local run and CI have to be the same run

CI checks out the repository and nothing else. A local checkout collects
whatever is lying around it, and the two quietly stop agreeing.

That happened here (#60). A git *worktree* — a second checkout of the same
repo, on another branch, parked in `.claude/worktrees/` — never shows up
in `git status`, so it feels invisible. But vitest doesn't read
`.gitignore`. It walked into that copy and collected every test a second
time, from a commit that had nothing to do with the branch being worked
on. A run that should have found 24 files found 46, and the inflated count
was quoted as evidence in two pull requests before anyone noticed.

A detail that made it worse: the path was ignored only through
`.git/info/exclude`, a per-machine file that is never committed. So the
"git ignores it" everyone relied on was true on exactly one computer.
`.gitignore` now carries it instead.

The count was the harmless part. The real hazard is that the duplicate is
pinned to an old commit: it can pass while the working tree is broken, or
fail for reasons belonging to a branch nobody is touching, and either way
the failure points at a file path that looks almost right. The fix is one
line in `vitest.config.ts`:

```ts
exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
```

Two deliberate details. Spread `configDefaults.exclude` rather than
assigning a fresh array, because assigning replaces vitest's defaults and
`**/node_modules/**` is one of them. And exclude the *worktrees*
directory, not all of `.claude` — the rest of that directory is tracked,
and `.github/workflows/promote.test.ts` already shows this repo testing
config that lives in a dot-directory. A glob wide enough to cover the
problem and then some will one day swallow a test you meant to run, and
vitest doesn't report what it skipped.

The general rule worth keeping: **git-ignored is not tool-ignored**. Every
tool that walks the filesystem — a test runner, a linter, a bundler, a
search — has its own idea of what to skip, and "git doesn't track it" tells
you nothing about what they will do. When a local number and CI's number
disagree, don't reconcile them by picking the one you like; find out why.

## Not every test needs a browser

Vitest gives each test file an *environment*: the set of globals it runs
against. There are two in play here.

- **`node`** — plain Node. No `document`, no `window`, no DOM.
- **`jsdom`** — a fake browser built in JavaScript, with all of those.

Building that fake browser is not free, and it happens **per file**. The
default was `jsdom`, so all 34 test files paid for one. Eight of them
actually need it. The other 26 exercise server actions, library
functions, SQL text and workflow files, and never touch the DOM.

That was roughly three quarters of the suite's running time, spent
furnishing rooms nobody entered. The default is now `node`, and a file
that needs a browser says so on its first line:

```ts
// @vitest-environment jsdom
```

Whole run: about 2.3 seconds to about 1.4.

**What this costs you.** A new test that renders a component without that
line fails with `ReferenceError: document is not defined`, pointing at the
`render()` call. Clear enough once you know, mystifying if you don't,
which is why `vitest.config.ts` names that exact error next to the
setting.

**The trap worth knowing about**, found in review rather than by a failing
test. `lib/notifications/this-device.test.ts` fakes a `navigator` to test
service-worker handling. Moved to `node`, it kept passing — because Node
21 and later happen to ship a global `navigator` of their own. Nothing in
this repo pins the Node version outside CI, so on Node 20 it would have
thrown, and meanwhile its own header comment still claimed it was running
in jsdom. It asks for jsdom again now.

The general shape: **a test that passes tells you less than you think
about why.** This one passed before the change and after it, for two
different reasons, and only one of them was the intended one. When you
change what a test runs *against*, "still green" is not the same as
"still testing the same thing".
