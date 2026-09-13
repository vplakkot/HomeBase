# CLAUDE.md

## What this is
HomeBase: a household management app for couples. Solo project. The goal is
learning a maintainable process as much as shipping.

## Where things live
- Requirements, decisions, architecture: Notion (linked from README)
- Work items: GitHub issues, one per feature or bug
- Code, history, truth: this repo

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

## Definition of Done
Every pull request must satisfy all of these:
- [ ] Linked to a Ready requirement or a bug issue
- [ ] Every acceptance criterion has a passing test
- [ ] All automated checks pass
- [ ] Verified on the preview link
- [ ] CHANGELOG.md updated
- [ ] Database changes are migrations
- [ ] No secrets in code
- [ ] A lesson doc added or updated in docs/lessons/ for anything new
- [ ] Notion requirement status updated (my task)

## Working style
- Restate what you understood before starting, and wait for confirmation.
- Small steps. One concern per pull request.
- Direct and concise. Say when something is a bad idea.
- Use analogies for new concepts.
