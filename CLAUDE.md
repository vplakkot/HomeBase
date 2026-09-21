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
When I say "next requirement":
1. In Notion (HomeBase HQ → Requirements), check requirements that are
   In progress. If a requirement's pull request has merged, set it to Done.
2. Find the Ready requirement in the current milestone with the lowest ID.
3. If its Github Issue field is empty, create the GitHub issue: title = the
   requirement name, body = REQ ID and Notion link, milestone = the
   requirement's Milestone. Write the issue URL back to its Github Issue field.
4. Set the requirement to In progress.
5. The Notion page is the spec: acceptance criteria, out of scope, and
   decisions. Don't copy it elsewhere. Ask if anything is unclear.
6. Restate your plan in plain words, then start building. Stop for my
   go-ahead only when the plan holds a decision that's mine to make (a
   product choice the docs don't settle, a new dependency, an architecture
   change) or a step only I can take.

## Rules
- Never commit to main. Always a branch, then a pull request.
- One issue per pull request. Reference it in the PR description.
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
  merge it without asking me, then tell me what was merged. If I say
  "wait" on a pull request, hold it until I say otherwise. Release pull
  requests (the ones that bump package.json's version) and the tag push
  that follows them still wait for my go-ahead, because that is what puts
  code on the production domain.

## Reviews
Reviews cost more than anything else in a session. Spend them where they
catch things.
- One review per pull request. Re-review only if a fix changed code; a
  wording fix doesn't need another round.
- Never run two reviews at once.
- No review for a version-bump pull request. It waits for my go-ahead
  instead.
- The reviewer runs on Sonnet by default. Use Opus for risky code:
  migrations, row-level security, sign-in, anything the internet can
  call, and the service worker.
- Keep the brief short. Point the reviewer at the pull request; don't ask
  it to re-search the repo or re-measure things unless that is what the
  pull request is about.
- A review checks that the work agrees with itself, not that its claims
  about the outside world are true. Before a pull request says how
  Vercel, Supabase, iOS or any other outside system behaves, prove it
  against that system.

## Writing
- Commit messages: a subject line and at most 10 lines of body.
- Pull request descriptions: one screen. What changed, why, how it was
  checked.
- Lessons: under 100 lines, and only for a genuinely new concept, not for
  every chore or fix.

## Definition of Done
Every pull request must satisfy all of these:
- [ ] Linked to a GitHub issue — a feature from a Ready requirement, a bug,
      or a chore
- [ ] Every acceptance criterion has a passing test
- [ ] All automated checks pass
- [ ] Verified in a browser — locally by you, and on the preview link by me
      whenever I choose to (Vercel's own login no longer guards previews,
      but you have no HomeBase account, so signed-in pages stay mine)
- [ ] CHANGELOG.md updated
- [ ] Database changes are migrations
- [ ] No secrets in code
- [ ] A lesson doc added or updated in docs/lessons/ when there is a
      genuinely new concept (see Writing)
- [ ] Notion requirement set to Done once merged (you do this; see Picking
      up work) — not applicable to bug or chore issues

## Working style
- Restate what you understood before starting. Wait for my confirmation
  only when there's a decision in it for me (see Picking up work, step 6).
- Small steps. One concern per pull request.
- Direct and concise. Say when something is a bad idea.
- Use analogies for new concepts.
