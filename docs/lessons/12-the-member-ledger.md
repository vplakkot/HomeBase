# Lesson 12: The member ledger

REQ-15 ("admin console: members and roles") turns the empty console into
a roster: who is in the household, with which role, and a way to change a
role or hand out a replacement password. Three ideas underneath it are
worth keeping.

## Reading a private table on someone's behalf

Names and emails live in `auth.users`, a table Supabase keeps private —
the API never exposes it, and that's right: it holds password hashes and
tokens. The console still needs two columns of it.

The tool is the same one lesson 09 introduced for `has_permission`: a
`security definer` function. `household_members_overview()` runs with the
definer's rights, joins `household_members` to `auth.users` and `roles`,
and returns exactly five columns — id, name, email, role id, role name.
It never returns anything else, and its `where` clause is
`has_permission('manage_members')`: a caller without that key gets an
empty result, not an error and not a hint. Only `authenticated` may even
call it; `anon` isn't granted.

Think of it as a hatch in a locked door: it hands out one specific tray,
never the key to the room.

## Floors are data, like ceilings

REQ-12 made "at most two Admins" a number on the role (`max_holders`).
"The only admin can't demote themselves" is the mirror image, so it's the
mirror column: `min_holders`, 1 for Admin, empty for Member. A second
trigger on `household_members` refuses any role change or removal that
would leave a role below its floor. The app never checks "is this the
last admin?" — it sends the change, and the database either accepts it
or answers "This role must keep at least 1 holder(s)", which the console
shows as-is. Give a future role a floor and the same trigger guards it.

## A rule that outlived what it was protecting

The first version of that trigger fired on *every* delete of a membership
row — and a membership row is also deleted by Postgres itself, by cascade,
when the household it belongs to is deleted. So "the household must keep
an admin" ended up meaning "the household can never be deleted". The rule
outlived the thing it existed to protect (#57).

The fix is one condition: by the time a cascade reaches the membership,
Postgres has already removed the household row, so the trigger can ask
whether the household still exists and stand aside if it doesn't. What it
deliberately keeps refusing is deleting the *account* of the last admin,
because that leaves real members behind with nobody able to manage them —
the same shape as "you can't delete the last owner of an organisation".
The exception now carries a `hint` telling you the two ways out: hand the
role to someone else, or delete the household. A tear-down is therefore
household first, accounts second.

The general lesson: a guard written for one direction (demotion) will fire
in directions you didn't picture (cascade, teardown). When you write one,
list every way a row can leave the table — not just the way the feature
removes it.

## "Takes effect on their next page load" costs nothing

Permissions are never copied into the login token. Every page that cares
asks the database — `has_permission(...)` over RPC — on every request. So
when an admin changes someone's role, the next request that person makes
is already answered by the new row. There is no cache to bust and no
session to refresh; the requirement falls out of a decision made three
lessons ago.

Contrast the password reset: that *does* touch the token, indirectly.
Setting a password through the admin API logs the member out of every
session (the Auth server does this deliberately, so an attacker who knew
the old password is out too), and the same call sets `must_set_password`
in `app_metadata`. Their next sign-in — necessarily with the temporary
password — carries that flag in the fresh token, and lesson 11's gate
sends them to `/set-password`.
