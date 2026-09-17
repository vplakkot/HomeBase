# Lesson 06: The PR reviewer subagent

A new file, [`.claude/agents/pr-reviewer.md`](../../.claude/agents/pr-reviewer.md),
defines a Claude Code "subagent" that reviews a pull request against this
repo's own standards. This explains what that actually is, how to use it,
how it's different from the GitHub Actions checks already running, and how
to change its behavior later.

## What a subagent is

Claude Code (the assistant you're talking to when you work in this repo)
can run more than one "persona" at a time. A subagent is a saved,
reusable persona — a name, a job description, a specific set of tools it's
allowed to use, and a block of instructions — stored as a markdown file in
`.claude/agents/`. Instead of you re-explaining "read the PR, check it
against the issue, check the Definition of Done..." every time you want a
review, that instruction lives in one file and gets reused on request.

Think of it like a job description pinned to a specific role, versus
explaining the job from scratch to a new hire every single day. The
"employee" here is still Claude — the subagent file just hands it a
consistent brief.

The file has two parts:

```markdown
---
name: pr-reviewer
description: ...
tools: Read, Grep, Glob, Bash, WebFetch
---

(the actual instructions, as plain markdown)
```

The top section (between the `---` lines) is configuration: a name, a
one-line description of when to use it, and — importantly here — exactly
which tools it's allowed to touch. Everything below that is the brief
itself, written in plain English.

## Why it can't merge, push, or edit code

The `tools:` line lists `Read, Grep, Glob, Bash, WebFetch` — deliberately
**no** `Edit`, `Write`, or `NotebookEdit`. Those are the only tools that
can change a file, so leaving them out is a hard guarantee: whatever this
agent decides, it is structurally incapable of editing anything in the
repo, no matter how it's asked.

`git push`, `git commit`, and `gh pr merge` are a softer case — they run
through the `Bash` tool, which the agent needs anyway just to read PR
data (`gh pr view`, `gh pr diff`, `gh issue view`). There's no setting
that carves "read-only git commands" out of "all shell commands," so that
boundary is enforced by the agent's own instructions ("never run git
push/commit or gh pr merge/edit/comment/close") rather than by a tool
being physically absent. It's a strong, explicit boundary, and Claude
generally treats destructive actions carefully by default regardless —
but it's worth knowing it's a documented rule the agent follows, not a
technical wall like the missing Edit/Write tools. If that distinction ever
matters more than it does today, restricting the repo's own
`.claude/settings.json` Bash permissions is the harder version of the same
guarantee.

## How to invoke it

Inside a Claude Code session in this repo, ask for it by name or by task
— for example:

> Use the pr-reviewer subagent to review PR #22

Claude Code loads its instructions from the file and runs the review as
that persona, using only the tools listed. You'll get back the report
shape defined in the file (a verdict, acceptance criteria, Definition of
Done, risk flags, what to check yourself) — nothing gets merged or
changed as a side effect.

## How this differs from the GitHub Actions checks

They solve different problems:

| | GitHub Actions CI (`.github/workflows/ci.yml`) | pr-reviewer subagent |
|---|---|---|
| Runs | Automatically, on every PR | On request, when you ask for it |
| Checks | Mechanical facts: does it type-check, build, pass tests, did CHANGELOG.md change | Judgment calls: does the code actually satisfy the issue's intent, is a change in scope, does a test really cover the claim |
| Can it be wrong for a good reason | No — it's a fixed pass/fail per command | Yes — it can flag something as "needs a human look" instead of forcing a verdict |
| Output | Green/red check on the PR | A written report you read yourself |

CI is fast, deterministic, and blind to intent — it doesn't know if a PR
actually does what its issue asked, only whether the code type-checks and
the tests pass. The subagent reads for intent — comparing the diff against
what the issue said should happen — which isn't something a fixed script
can do. Neither replaces the other: CI catches mechanical breakage the
moment it happens; the subagent gives a second opinion when you want one,
closer to what a human reviewer would look for before approving.

## Editing its instructions later

Everything about how it behaves lives in that one file — there's nothing
elsewhere to keep in sync. To change what it checks, how it reports, or
what tools it can touch, edit
[`.claude/agents/pr-reviewer.md`](../../.claude/agents/pr-reviewer.md)
directly:

- To make it stricter or looser about a check, edit the relevant bullet
  under "What to check"
- To change the report format, edit the "Output" section
- To grant or remove a capability, edit the `tools:` line in the
  frontmatter — for example, adding `Bash(gh pr comment:*)`-style
  permission scoping would need repo-level settings, not this file, per
  the note above
- Like any other file in this repo, changes to it go through a branch and
  a PR, same as this one did
