# Changelog

## Unreleased

- First sign-up creates the household and makes that person its Admin;
  from then on sign-up is closed and the app only offers sign-in. This
  brings Supabase (Postgres + Auth) into the code for the first time: the
  `households`, `roles` (Admin, Member) and `household_members` tables
  arrive as the first migration in `supabase/migrations/`, a database
  trigger enforces the one-household rule, and row-level security is on
  from day one. Adds `@supabase/supabase-js`, `@supabase/ssr`, and the
  Supabase CLI as a dev dependency. `/sign-in` is a placeholder until the
  next requirement fills it in. (#33)
- Fix the promote workflow to find the Vercel build made from the exact
  commit a release tag points to, instead of whatever build Vercel
  considers "latest" — which could be a newer, unreleased commit on
  `main` if one merged after the release PR but before its tag was
  pushed. It now fails loudly and leaves production unchanged if no
  build exists for the tagged commit. (#31)
- Add a "Picking up work" section to CLAUDE.md: when asked for the next
  requirement, create its GitHub issue from the Ready Notion requirement,
  set it In progress, and mark it Done once merged. Also names the HomeBase
  HQ Notion page directly. (#29)

## 0.0.5 - 2026-09-18

- Tighten the promote workflow's tag trigger to real semantic version tags
  only (v0.0.5, not v.0.0.1-style typos), with a test verifying the
  pattern matches real versions and rejects malformed ones, and adopt a
  bump-then-tag release process: package.json's version and this
  changelog now get bumped in the PR that merges to main, and the git tag
  pushed afterward
  matches what the code already states about itself. (#27)
- Add a pr-reviewer Claude Code subagent that reviews a PR against its
  linked issue and CLAUDE.md's Definition of Done on request. Advisory
  only — no ability to merge, push, or edit code. (#25)
- Remove the deliberate Sentry test route now that error reporting is
  confirmed working in both the browser and the server. (#21)
- Integrate Sentry error tracking for both browser and server errors, DSN
  read from NEXT_PUBLIC_SENTRY_DSN. Adds a /sentry-test page with two
  deliberate test errors, to be removed after confirming it works. (#19)
- Show the running build's git ref and commit hash in small text at the
  bottom of the homepage, read from Vercel's build-time environment
  variables. (#17)
- Add a vercel whoami diagnostic step to the promote workflow, so an
  auth/scope problem with VERCEL_TOKEN surfaces its own clear error
  instead of being buried inside vercel promote's failure. (#15)
- Fix promote workflow failing with "User not found (404)" by passing
  --scope explicitly to vercel promote. (#13)
- Add GitHub Actions workflow that promotes the latest production build to
  the production domain only when a version tag (v*) is pushed, using the
  Vercel CLI. (#11)
- Update Definition of Done in CLAUDE.md to allow chore issues, not just
  Ready requirements and bugs. (#9)
- Add GitHub Actions workflow that runs on every pull request: type check,
  tests, build, and a check that CHANGELOG.md was updated. (#7)
- Add blank Next.js app skeleton: homepage shows "HomeBase," one passing
  test, no styling or features yet. (#3)
