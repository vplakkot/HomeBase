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
6. Restate your plan and wait for my go-ahead.

## Rules
- Never commit to main. Always a branch, then a pull request.
- One issue per pull request. Reference it in the PR description.
- Never commit secrets. Keys and passwords live in Vercel, never in git.
- Database structure changes go through migration files in git, never by hand
  in the Supabase console.
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

## Definition of Done
Every pull request must satisfy all of these:
- [ ] Linked to a GitHub issue — a feature from a Ready requirement, a bug,
      or a chore
- [ ] Every acceptance criterion has a passing test
- [ ] All automated checks pass
- [ ] Verified in a browser — locally by you, and on the preview link by me
      whenever I choose to (it sits behind Vercel's login, so you can't)
- [ ] CHANGELOG.md updated
- [ ] Database changes are migrations
- [ ] No secrets in code
- [ ] A lesson doc added or updated in docs/lessons/ for anything new
- [ ] Notion requirement set to Done once merged (you do this; see Picking
      up work) — not applicable to bug or chore issues

## Working style
- Restate what you understood before starting, and wait for confirmation.
- Small steps. One concern per pull request.
- Direct and concise. Say when something is a bad idea.
- Use analogies for new concepts.
