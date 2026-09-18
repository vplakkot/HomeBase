# Changelog

## Unreleased

- Admin creates a member account: a form on the admin console takes a
  name, email and temporary password and creates the account directly —
  no email is sent. A new `member_invitations` table (writable only with
  the `manage_members` permission) is what the sign-up trigger checks:
  an invited email gets a membership with the Member role and the
  invitation is used up; anything else is still refused as before. On
  first sign-in with a temporary password, the person is sent to
  `/set-password` and can go nowhere else until they choose their own.
  Adds a server-only Supabase admin client that uses
  `SUPABASE_SECRET_KEY`. (#49)
- Admin/member mode toggle: admins land in the ordinary member view and
  switch into admin mode with a button on the home page, which reveals an
  "Admin mode" banner, a link to the new `/admin` console page and a way
  back. The mode is a session cookie, so closing the app returns to member
  view. Both the toggle and `/admin` are gated on the `manage_members`
  permission — members never see the toggle, and `/admin` sends them home
  if they type the URL. (#48)
- Roles and permissions stored as data: a `role_permissions` table holds
  each role's keys (`use_modules`, `manage_members`, `manage_roles`), and
  row-level security policies now gate every table on `is_member()` or
  `has_permission(...)` — never on a role name — so a future role is new
  rows, not new code. Any member reads all household data; changing
  memberships or roles needs the matching permission. Roles carry a
  `max_holders` limit (2 for Admin) enforced by a trigger. App code gets
  `hasPermission()`, first used on the home page, and a test that fails
  if any app code compares against a role name. (#39)
- Sign in with email and password, and sign out. A new `proxy.ts` runs
  before every page: it refreshes the Supabase session and sends
  signed-out visitors to `/sign-in` (only `/sign-in` and `/sign-up` stay
  reachable). Every sign-in failure shows the same message so the form
  can't be used to find out which emails have accounts. Sign-out ends
  this device's session only; other devices stay signed in. The home
  page now shows who is signed in and a sign-out button. (#35)
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
- Commit `.claude/launch.json`, the Claude desktop app's config for
  starting the dev server (`npm run dev`, port 3000) in its browser pane.
  Tool config only; nothing in the app, Vercel, or CI reads it. (#38)
- Apply migrations automatically: a new GitHub Actions workflow runs
  `supabase db push` against the hosted project whenever a push to `main`
  touches `supabase/migrations/**`, one run at a time, using two
  repository secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`).
  A structural test pins that it only ever runs for `main`, never carries
  a literal password, and never touches project config. (#43)
- CLAUDE.md: Claude merges its own pull requests once every Definition of
  Done item is met and the pr-reviewer agent's verdict is "Ready to
  merge", and says what it merged; "wait" on a PR holds it. Release PRs
  and the tag push still wait for Vin's go-ahead. The "verified on the
  preview link" item now says who verifies where, since the preview sits
  behind Vercel's login. (#44)
- Add `.claude/settings.json` allowing Claude Code to run
  `npx supabase db push` without a prompt, and explicitly denying
  `npx supabase config push` (which would overwrite hand-tuned project
  settings). Migrations stay reviewed in their PR; only the button press
  moves. (#42)

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
