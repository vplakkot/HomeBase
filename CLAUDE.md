# CLAUDE.md

## What this is
HomeBase: a household management app for couples. Solo project. The goal is
learning a maintainable process as much as shipping.

## Where things live
- Requirements, decisions, architecture: Notion (HomeBase HQ, linked from README)
- Work items: GitHub issues, one per feature or bug. Feature issues are
  created by you from Ready requirements (see Picking up work)
- Code, history, truth: this repo

## Picking up work
A **batch** is the unit of work: 3-4 Ready requirements from the current
milestone that belong together — they touch the same screen, the same
tables, or one can't be tested without another. Smaller is fine when
nothing else fits; more than four is too much to review in one go. A bug
or a chore is a batch of one.

When I say "next batch" (or "next requirement"):
1. In Notion (HomeBase HQ → Requirements), check requirements that are
   In progress. If a requirement's pull request has merged and every
   acceptance criterion is now met, set it to Done. One whose remaining
   criteria wait on a later batch stays In progress.
2. Pick the next batch. Follow the milestone's batch plan if one exists
   (in Notion or in your memory); otherwise group the Ready requirements
   yourself, in dependency order rather than by ID, and say which you
   picked and why before building.
3. Create one GitHub issue for the batch: title = what the batch
   delivers, body = each requirement's ID, name and Notion link, and any
   criteria you already know wait for a later batch; milestone = the
   requirements' Milestone. Write the issue URL into the Github Issue
   field of every requirement in it.
4. Set each of them to In progress.
5. The Notion pages are the spec: acceptance criteria, out of scope, and
   decisions. Don't copy it elsewhere. Ask if anything is unclear.
6. Restate your plan in plain words, then start building. Stop for my
   go-ahead only when the plan holds a decision that's mine to make (a
   product choice the docs don't settle, a new dependency, an architecture
   change) or a step only I can take.
7. One batch per session. When it's merged, tell me what landed and stop;
   start the next one in a new session, so the conversation doesn't grow
   for the rest of the day.

## Rules
- Never commit to main. Always a branch, then a pull request.
- One issue per pull request, and one pull request per batch. Reference
  the issue in the PR description. When a requirement in the batch has
  criteria only a later batch can prove, name them in the pull request
  and leave that requirement In progress.
- Never commit secrets. Keys and passwords live in Vercel, never in git.
- Database structure changes go through migration files in git, never by hand
  in the Supabase console.
- Only one pull request containing a migration is open at a time. A migration
  reaches the Supabase project before it reaches main, so two open ones make
  migrate.yml fail on the first merge, whichever order you pick. Merge one and
  wait for its migrate.yml run to pass before opening the next. Reasoning in
  docs/lessons/07-supabase-auth-and-migrations.md.
- Test data is fake. No real household details.
- Ask before adding a dependency or changing architecture.
- Explain changes in plain language. Assume I am learning, not reviewing
  as an expert.
- docs/architecture.md must be updated in the same pull request whenever
  the structure changes: a new external service, a new data model, or a
  change in how pieces connect.
- Releases: bump package.json's version and add its CHANGELOG.md section
  in the pull request itself, merge to main, then push the matching
  vX.Y.Z tag. The tag never gets created before the code it points to
  already states that version.
- Merging: once every Definition of Done item is satisfied and the
  pr-reviewer agent's verdict on the pull request is "Ready to merge",
  merge it without asking me, then tell me what was merged. A "Needs
  changes" verdict counts too, if every finding was wording and all are
  fixed; if any finding was code, re-review first. "Needs a human look"
  always comes to me. If I say "wait" on a pull request, hold it until I
  say otherwise. Three kinds wait for my go-ahead whatever the verdict:
  release pull requests (the ones that bump package.json's version) and
  the tag push that follows, because that is what puts code on the
  production domain; and any change to this file, because these are the
  rules you work under.

## Reviews
Reviews cost more than anything else in a session. Spend them where they
catch things.
- One review per pull request. Re-review only if a fix changed code.
  Code is anything that runs or decides what runs: app code, tests, SQL,
  workflows, and `.claude/` settings. Wording is prose: docs, lessons,
  comments, CHANGELOG, and this file.
- Never run two reviews at once.
- No review for a release pull request that only bumps the version and
  its CHANGELOG section. It waits for my go-ahead instead.
- Name the reviewer's model every time you launch it; don't rely on its
  default. Sonnet, unless any file in the pull request is risky:
  migrations, row-level security, sign-in, `app/api/**`, the service
  worker, `.github/workflows/`, or `.claude/settings.json`. Then Opus.
- Keep the brief short. Point the reviewer at the pull request; don't ask
  it to re-search the repo or re-measure things unless that is what the
  pull request is about.
- A review checks that the work agrees with itself, not that its claims
  about the outside world are true. Anything in a pull request — code,
  docs or description — that says how Vercel, Supabase, iOS or another
  outside system behaves must first be shown by running it against that
  system. If that can't be done from here, say it is unproven.

## Writing
- Commit messages: a subject line and at most 10 lines of prose, not
  counting blank lines or the trailer.
- Pull request descriptions: about 25 lines. What changed, why, how it
  was checked.
- New lessons: under 100 lines, and only for a concept no existing lesson
  covers. Updating an existing lesson has no length limit.

## Definition of Done
Every pull request must satisfy all of these:
- [ ] Linked to a GitHub issue — a batch of Ready requirements, a bug,
      or a chore
- [ ] Every acceptance criterion has a passing test, except those the
      pull request names as waiting for a later batch
- [ ] All automated checks pass
- [ ] Verified in a browser — locally by you, and on the preview link by me
      whenever I choose to (Vercel's own login no longer guards previews,
      but you have no HomeBase account, so signed-in pages stay mine)
- [ ] CHANGELOG.md updated
- [ ] Database changes are migrations
- [ ] No secrets in code
- [ ] A lesson doc added or updated in docs/lessons/ when there is a
      genuinely new concept (see Writing)
- [ ] Every Notion requirement in the batch set to Done once merged, or
      left In progress with its waiting criteria named (you do this; see
      Picking up work) — not applicable to bug or chore issues

## Working style
- Restate what you understood before starting. Wait for my confirmation
  only when there's a decision in it for me (see Picking up work, step 6).
- Small steps. One concern per pull request.
- Direct and concise. Say when something is a bad idea.
- Use analogies for new concepts.
