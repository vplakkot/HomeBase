# Lesson 10: Modes are not roles

> **This describes v0.1.** v0.2 removed the admin mode, its cookie and
> the tests named below; see [What v0.2 changed](#what-v02-changed) at
> the end. The idea still holds.

REQ-14 ("admin/member mode toggle") is small, and the one idea in it is
worth keeping straight for every screen that comes later.

## The distinction

The Platforms page in Notion puts it in two sentences: *roles decide what
you can do; a mode is a switch that a role unlocks.* An admin on a phone
can still administer; a member on a laptop still sees the member view.
And an admin doing the dishes wants the same simple screen a member has —
hence: admins default to member view, and flip into admin mode only when
they need it.

So there are two separate questions on every page:

| Question | Answered by | Lives in |
|---|---|---|
| May this person do X? | `has_permission('…')` | the database (lesson 09) |
| Is this person currently *in* admin mode? | the `homebase-mode` cookie | the browser, for this session |

Mode never grants anything. A member who somehow acquires an "admin"
cookie sees exactly what a member sees, because every admin affordance
checks the permission *and* the mode — the home page test "never shows a
member the toggle, even with a stray admin cookie" pins that.

## Why a session cookie

The requirement says admin mode is forgotten each session. A cookie
written with no `Max-Age` and no `Expires` is a **session cookie**: the
browser drops it when it closes (on an installed iPhone app, when the app
is closed). That is the whole implementation of "back to member view" —
no timer, no database column, and the action test asserts the cookie is
set without either attribute so nobody adds one by accident.

The cookie is `httpOnly` (JavaScript in the page can't read or forge it)
and only ever holds the word `admin`; anything else reads as member view.
Signing out deletes it too, so signing back in — a new session by any
definition — always starts in member view.

One honest caveat: a browser set to "continue where you left off" (and
some installed-app shells) can restore session cookies after a restart,
so admin mode may occasionally survive a close-and-reopen. For a
two-person household app that is acceptable; the alternative — an
expiry — would turn "each session" into "every N hours", which is a
different rule. If it ever matters, that is the knob.

## Refusing by URL

"Admin pages refuse me if I type their URL" is enforced by the page, not
the proxy. The proxy (lesson 08) only knows whether someone is signed
in; asking the database for a permission on every request would be
wasted work for the many pages that don't need it. So `/admin` does the
check itself and redirects a non-holder home. As more admin pages arrive
they follow the same three lines — and if that repetition grows, a shared
`requirePermission()` helper is the natural next step.

## What v0.2 changed

The mode is gone. The v0.2 design gives admins an **Admin pill** on Home
that opens the console directly, and shows admin-only controls to
everyone, locked for members, instead of hiding them. Vin decided on
2026-09-21 to drop the switch, so the button, the `homebase-mode` cookie
and the code behind them were removed.

The distinction this lesson draws still stands, just with one side
emptied. Roles still decide what you can do, through the same
permission check. What went is a *second* thing that decided what the
screen shows. The pill is only shown to people with the permission, but
that's politeness: `/admin` checks for itself, as described above, so a
member who types the address is still sent home. A later requirement
moves the pill into a profile menu, with one extra button for admins.
