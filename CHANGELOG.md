# Changelog

## Unreleased

- A saved split lists each person on their own line with their
  percentage in the same size as an income source's amount, and an
  income source saved without a name no longer shows the owner's name
  twice. (#135)

- The Budget year cards read more evenly. Each card's explanation moved
  onto an info icon in its head, so all three heads are one line and line
  up; the cards run Income sources, Bills, then Split, which changes
  about once a year; a saved split shows only its month, whether it's in
  force, and each person's percentage; and everything saved is now a tile
  in the Finances colour, like Home's module tiles, with chips solid
  rather than see-through so the text stays readable on it. A card's hint
  shows on keyboard focus as well as on hover. (#133)

- The split can change during the year. Instead of one percentage per
  budget year, you save a split that starts in a month you choose — "from
  October 2026, 70/30" — and it holds until a later one starts. A split
  whose month has passed can't be changed, saved over or removed: it's
  history, and the months it covered keep it. The month you're in can
  still change. Changing an income source works the same
  way — the old one ends and a new one starts from today, so paydays
  already past keep their amount — and removing one ends it rather than
  erasing it.
- The Budget year section looks like Finances. All three cards share one
  shape — a brick head with the card's name, the form for adding on the
  module's tint, then what's saved as rounded boxes — and every saved
  split, income source and bill that can still change carries Edit as
  well as Remove. An income source now reads in two lines instead of
  four. (#132)

- The Budget year setup reads better and asks less. The split no longer
  asks which year: it works the budget year out from today and says
  "Your budget year runs April 2026 to March 2027". Income sources now
  have a name, so two jobs can be told apart. In both the income and
  bills cards, the form for adding sits at the top on its own tinted
  block and stays there, with what's already saved listed below it as
  rows; changing a saved bill is folded behind "Change". A bill's due
  day is picked from a list of days of the month (1st, 2nd, 22nd)
  instead of typed as a number, and the form says that shorter months
  use their last day. Before a split is saved, the card says so rather
  than talking as if one existed. (#128)

- How work is picked up changed: CLAUDE.md now treats a batch of 3-4
  related requirements as one pull request, with one GitHub issue, one
  review and one session each, and says what a batch is. Nothing in the
  app changed. (#126)

- Finances can be set up. An admin opens the new Budget year section
  (from Start setup on Finances, the desktop tab or the phone's Sections
  sheet) and sets three things: the split, each person's percentage for
  a budget year running April to March, which must total exactly 100,
  with a note of what it was based on; each person's income sources,
  as take-home per payment, how often, and one real payday, with the
  next three paydays worked out; and the household's bills, each with a
  type (rent, card or other) and the day it's due. Members see the
  section locked, "Admin only". Until a budget year exists, Finances is
  one card: Start setup for an admin, and for a member, which admin to
  ask. Afterwards it lists the bills with their due dates, marked "Not
  entered" (entering them comes with monthly entry), and the year's split
  in an Admin block. Dates follow the household's own day, US Eastern.
  (REQ-50, REQ-51, REQ-94)

## 0.2.0 - 2026-09-22

HomeBase in its design: tokens and fonts, the icon, phone and desktop
layouts, the designed Home with loud and quiet module tiles and the
action items card, an account pill and sidebar buttons for Profile,
Settings and Sign out, the Finances shell with its header and section
tabs, the admin console's three cards, and a sign-in page with the logo.
Modules still have no data, so Home is calm and Finances says it's
coming; `?demo` on Home shows every state of the tiles and cards.
Not yet checked on an iPhone: how the layout meets the notch and home
bar, and swiping the action items with a finger.

- Your account has one place of its own. On a phone, the pill at the top
  right of Home (where the Admin pill was) shows your initial and name
  and opens a menu: Profile, Settings, Sign out, and Admin console for
  admins. On a desktop, Profile, Settings and Sign out are three buttons
  at the bottom of the sidebar, under Admin console. Profile shows who
  you're signed in as; Settings holds this device's notifications and
  the build line. None of it sits at the bottom of Home any more. (#122)

- Sign-in now looks like HomeBase: the app icon and name above the form,
  in one centred column on a phone and a desktop. Fields are 52 px tall
  with 16 px text, the size iPhones need so they don't zoom in on a tap
  (not yet checked on an iPhone), and the Sign in button is full width.
  A wrong password shows in red above the button. Sign-up and
  set-password get the same look. (#119)

- The admin console has the design's three cards: People, Notifications
  and Modules (on a phone in that order: Notifications, Modules, People;
  on a desktop, People and Notifications beside Modules). Everything
  that already worked still works: adding a person (now behind "Add
  person"), changing a role, resetting a password, each person's
  notification switch (now a real on/off switch) and the test to
  everyone. The module switches and a test for one person are shown but
  can't be pressed yet. The notification log stays below the cards.
  (#117)

- The Finances page has its designed header: the Finances icon and
  name, the month (from the phone's own clock) and a "No budget year"
  status, since none is set up until v1.0. On a desktop its sections sit
  in a row of tabs under the header, Overview first and Budget year
  marked with a lock; Log payment will be a button of its own. Choosing
  another month and opening a section come with v1.0. (#68)

- Home's action items card now has the design's shape. On a phone it
  shows one dark card at a time; with two or three items you swipe
  sideways between them, and a "1 / 3" counter, dots and stacked edges
  show where you are. On a desktop the cards sit side by side. Each card
  shows the module's icon on its bright colour, a line of text, a line
  of detail and an arrow, and Home shows only the three most urgent.
  Modules have no data yet, so Home still says "All clear"; `?demo`
  shows three items, and `?demo=0` to `?demo=4` show every state. The
  cards don't open anything yet; that needs the screens they'll lead to.
  (#114)

- Home's module tiles now have both of the design's states. A tile turns
  its module's bright colour only when that module has an action item,
  and stays in its pale tint otherwise. On a desktop each tile shows a
  headline and two facts under its name. Modules have no data yet, so
  every tile stays pale and says "Coming soon". Add `?demo` to Home's
  address to see the design's example: Finances, Pets and Health bright,
  the rest pale. Text on a bright tile uses the colour the design made
  for it, not the mockups' paler lines, which were too faint to read
  comfortably. (#112)

- HomeBase now has its designed phone and desktop layouts, and a
  designed Home. On a phone, Home shows the brand and (for admins) the
  Admin pill, a greeting with the date, an "All clear" row where action
  items will go, and a tile for each of the six modules, with Quick add
  (Expense, Event, Meal) fixed at the bottom. From 1024 px wide, a
  sidebar takes over the navigation and Home spreads to three columns;
  resizing a window switches on the spot. All six modules are listed,
  but only Finances opens, to an empty page saying it's coming, with a
  Home · Sections · Modules bar at the bottom on phones. Quick add and the
  sections are all "coming soon". A test checks that everywhere the
  desktop sidebar goes, a phone can go too. Not yet checked on an
  iPhone: how the layout meets the notch and the home bar. (#107, #110)

- Admins now reach the admin console from an "Admin" pill at the top
  right of Home, which members don't see. The v0.1 admin mode is gone:
  no more "Enter admin mode" and "Back to member view" buttons, and the
  cookie that remembered the choice is no longer read or written. Who can
  open the console hasn't changed: the page checks the permission itself,
  so a member who types its address is still sent home. (#108)

- HomeBase has its own icon: the design's white roof over four module
  tiles, on the phone's home screen and in the browser tab. On Home, the
  plain "HomeBase" heading becomes the brand lockup, the icon beside the
  name in the display font, top-left. The home-screen icons are exported
  square, as the design asks, because iPhones round the corners
  themselves. One script makes every icon file from the design's own
  icon, and tests check each file's size and that its corners are solid.
  Not yet checked on a phone: whether an app already installed shows the
  new icon without being removed and added again. (#105)

- Every page now uses the v0.2 design's colours and fonts: headings in
  Bricolage Grotesque, everything else in Plus Jakarta Sans, on a
  warm-white page. Every colour, font, corner size and spacing value is
  defined once, in the design's own file, and the app reads that file
  directly, so the two can't drift. The fonts are downloaded while the
  app is built and served from HomeBase's own address, so opening the
  app never contacts Google. Tests measure every text colour against the
  4.5:1 contrast minimum, and fail on any raw colour code, font or corner
  size in the app's styles. Pages keep their plain layouts for now; the
  designed screens come next. (#103)

- Reviews now run once per pull request, never two at once, and not at
  all for version bumps. The reviewer defaults to Sonnet, with Opus kept
  for risky code. CLAUDE.md gains limits on commit, PR and lesson length,
  and a rule to prove claims about outside systems before making them.
  (#100)

- The service worker now takes over as soon as it installs, instead of
  queueing behind the old one. A new worker normally waits until every
  window using the previous one has closed, which on a phone is close to
  never — so the code that reports a delivered notification was
  downloaded and then held back. It cost the first night of the v0.1 test
  week: 19 notifications arrived, and all 19 were recorded as never
  delivered. (#96)

- Recorded what the v0.1.0 release actually proved. Three lessons still
  said a notification arriving on a real iPhone was waiting for a phone;
  it arrived, unattended, on the first hourly send after the release.
  Lesson 16 keeps the honest half: the outbound leg is proven and the
  receipt did not report, which the log itself is what revealed. (#94)

## 0.1.0 - 2026-09-20

The first release anyone in the household can actually use: sign in,
manage members, install it on a phone, and start the week of hourly test
notifications that decides whether push is reliable enough to build on.

- A notification log in the admin console: every send recorded with who
  it went to, which device, what triggered it, and whether it arrived.
  The phone reports its own deliveries and taps, because nothing else
  knows — handing a message to Apple says Apple took it, not that a
  phone ever saw it. That report arrives with nobody signed in, so it
  proves itself with a one-use secret carried inside the message, which
  only the device it was sent to can read. The log keeps a one-way
  fingerprint of each device rather than its push address, since that
  address is what lets anyone send to the phone, and a hash of each
  device's one-use secret rather than the secret, so that an admin
  reading the log cannot quote one back and record a delivery that never
  happened. A send with no word back
  after five minutes shows as missing; one the push service refused shows
  as refused, because those are different failures. Entries older than 30
  days delete themselves daily. (#79)
- Undid yesterday's wrong claim that merging to `main` is releasing. It
  is not: production is `home-base-peach.vercel.app`, it only moves when
  a tag is pushed, and it was still serving v0.0.5. The mistake came
  from reading `vercel project ls`'s "Latest Production URL" column,
  which names the newest *build*, not the address visitors see. CLAUDE.md
  gets its real reason back, and lesson 03 now names all three kinds of
  address and the check that settles which is which. Lesson 15 records
  that the hourly job's address points at the build-following alias
  rather than production, and has to move when v0.1 ships. (#88)

- Test files now run in Node unless they actually render something.
  Vitest was standing up a fake browser for all 34 files when only 8 need
  one, which was about three quarters of the suite's running time. The
  run drops from roughly 2.3 to 1.4 seconds with no assertion changed.
  (#85)

- Corrected two docs that went stale when Vercel's own login was switched
  off: CLAUDE.md and lesson 13 both still said preview links sat behind
  it. Lesson 13 also blamed the wrong mechanism — Next.js marks the app
  card's link for cookies because the build is a preview, not because
  previews were protected, so the phone still sends them; they are
  simply unused now. Docs only. (#82)

  This entry originally claimed a good deal more, about merging being
  releasing. That was wrong, and the entry above undoes it. Corrected
  here rather than left standing, because nothing in Unreleased has
  shipped yet and a release note should not contain a falsehood and its
  retraction one paragraph apart.

- CLAUDE.md: after restating the plan for a requirement, Claude starts
  building instead of waiting for a go-ahead. It stops to ask only when
  the plan holds a decision that's Vin's to make, or a step only Vin can
  take. Vin had given this permission in an earlier chat, but it lived
  only in that chat, so a fresh one stalled waiting for approval it
  already had. Docs only. (#71)

- Hourly test notification, and a "Send test now" button in the admin
  console. Both send the same thing: one signed, encrypted message per
  device, to every device of every member whose switch is on. Switched-off
  members' devices are never even fetched. A device whose push service
  says it is gone (`404`/`410`) has its row removed, so the table can't
  fill with addresses nothing can reach. Adds the `web-push` package,
  which does the signing and the per-device encryption. Vercel's free plan
  only allows a daily job, so the hourly clock lives in the database:
  a migration adds `pg_cron` and `pg_net` and schedules a call to
  `/api/notifications/test` on the hour. That address can't check a
  session, because the database isn't a person, so it compares a shared
  secret in constant time; the address and the secret live in Supabase's
  vault, never in git, and until both exist the job does nothing. Only an
  iPhone can prove a notification actually arrives, which is what the week
  after the v0.1 release is for. (#76)

- Signing out ends notifications on that device. The browser tells the
  push service to forget the device, the server removes that one row from
  `push_subscriptions`, and then the session ends; a failed clean-up is
  logged rather than trapping anyone in a session. Turning notifications
  on records which device this browser is, in an `httpOnly`
  `homebase-device` cookie. Without this, once REQ-21 starts sending,
  notifications would keep arriving on a device their owner had signed
  out of, and a second person on a shared device could never turn
  notifications on, because the address was taken. Two guards keep the
  wrong person from being enrolled: notifications are only switched on by
  themselves for a device that cookie says this person turned on, so
  anyone else has to tap; and signing in clears the cookie left by
  whoever was here before. If an address is still held by someone who
  never signed out, tapping Enable signs up again for a fresh one. Their
  other devices are unaffected, which matches sign-out ending this
  device's session only. (#75)

- Opt in to push notifications. The home page gains a Notifications
  section. In a normal browser tab it explains that notifications need
  the home-screen install. In the installed app it offers **Enable
  notifications**, which asks the phone's permission as the first thing
  the tap does, then signs the device up with its push service and saves
  the result against the signed-in person. A denied permission shows as
  off, with the way back through the Settings app. A new
  `push_subscriptions` table holds one row per device, so a person can
  have several. Each member sees and manages only their own rows, `anon`
  gets nothing, and a check refuses any address that isn't a push
  service's own, because REQ-21's sender will call every one. Adds the
  service worker (`public/sw.js`), which the proxy skips, and two new
  environment variables for the app's push keys. The live check of the
  table's rules is committed as `supabase/checks/push_subscriptions.sql`
  and undoes itself when run. Nothing sends yet; that is REQ-21. (#70)

- Installable as an app on iPhone. A web app manifest
  (`/manifest.webmanifest`) gives Add to Home Screen the name HomeBase, a
  placeholder icon (a white house on dark blue, in `public/` at 180, 192
  and 512 pixels), full-screen display and the home page as the start.
  Each page's head adds the iPhone-specific icon and title. The proxy now
  skips the manifest, because phones fetch it without cookies and would
  otherwise get the sign-in page. Tests pin the session cookies'
  400-day lifetime, which is what keeps you signed in between opens,
  both at sign-in (a real sign-in through our Supabase client) and when
  the proxy renews the session. What only an iPhone can show, the icon on
  the home screen, the full-screen launch and staying signed in between
  launches, is still to be checked on a real phone. (#69)

- Per-member notification switch in the admin console. Each membership
  carries a `notifications_enabled` flag, off by default, so a new member
  — including the household's first admin — starts switched off without
  either sign-up path having to say so. Only `manage_members` holders can
  change it, and members cannot see it at all: the table-wide `select`
  grant on `household_members` is withdrawn from `authenticated` and
  re-granted column by column, leaving this one out, so even `select=*`
  is refused. `anon` is withdrawn outright with nothing handed back,
  since every policy on the table is already `to authenticated` and a
  signed-out visitor has no business reading any of it. The roster function is re-created (not replaced, since its
  columns changed) to return the flag to admins. Nothing sends
  notifications yet; REQ-21 will read this flag. (#66)

- CLAUDE.md: only one pull request containing a migration is open at a
  time. #62 wrote the reasoning into lesson 07, but a lesson explains and
  the Rules section is what binds. The working habit up to now has been to
  keep independent pull requests open side by side, and Claude is the one
  merging, so the constraint now sits where Claude reads its rules. (#64)
- Lesson 07: document why only one migration pull request should be open
  at a time. Because a migration reaches the hosted project before it
  reaches `main`, two open ones leave the remote ledger holding both
  while `main` still holds only one, and `migrate.yml` fails on the first
  merge with "Remote migration versions not found in local migrations
  directory". Records that merge order does not fix this, since the
  failure is symmetric, and that repairing the ledger only moves it.
  Seen for real merging pull requests #58 and #59. Docs only. (#62)
- Fix: invitations expire. Creating a member writes an invitation row and
  then creates the account; a crash between the two left the invitation
  behind, and an invitation never expired, so that address could sign
  itself up through the public form at any time afterwards. Invitations
  now last ten minutes and the sign-up trigger ignores any that have
  expired, which is what makes a leftover harmless. Clearing them out is
  separate and best-effort: the admin console sweeps expired rows before
  writing a new one, so a retry after a failed attempt works immediately
  instead of waiting out the clock. (#52)
- Fix: a household can be deleted again. The `min_holders` floor on a role
  fired on every removal of a membership row, including the cascade
  Postgres performs when the household itself is deleted, so "the
  household must keep an admin" had become "the household can never be
  deleted". The floor now applies only while the household still exists.
  Deleting the last admin's *account* is still refused — it would leave
  the other members with nobody able to manage them — and the error now
  carries a hint naming the two ways out. Tearing a household down is
  household first, accounts second. (#57)
- Stop vitest collecting tests from git worktrees. A worktree is a second
  checkout of the whole repo; vitest doesn't read `.gitignore`, so every
  test was collected twice from a commit unrelated to the branch in hand.
  Local runs reported 46 test files where the repo has 24, and those
  inflated counts were quoted as evidence in two pull requests. Adds
  `**/.claude/worktrees/**` to `exclude`, spread over
  `configDefaults.exclude` so `**/node_modules/**` survives, with tests
  pinning both. `.claude/worktrees/` also moves into `.gitignore`: it had
  only ever been ignored through `.git/info/exclude`, which is
  per-machine and never committed. Lesson 02 gains a section on why
  git-ignored is not tool-ignored. (#60)
- Admin console: members and roles. The console lists every member with
  name, email and role (names and emails come from Supabase's private
  `auth.users` through a `security definer` function that returns rows
  only to `manage_members` holders), lets the admin change a role from a
  dropdown fed by the `roles` table, and reset a member's password to a
  temporary one that must be changed at next sign-in (Supabase signs them
  out everywhere). Roles gain a `min_holders` floor (Admin: 1) enforced by
  a trigger, so the only admin cannot demote themselves. Role changes
  apply on the member's next page load because permissions are read from
  the database on every request. (#53)
- Lesson 07: document how to amend a migration that has already been
  applied to the hosted project but hasn't merged yet (edit the file,
  `supabase migration repair --status reverted`, then `db push`), the
  conditions that make it safe, and the #51 example. Docs only. (#54)
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
