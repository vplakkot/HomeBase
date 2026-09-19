# Lesson 11: Creating accounts for other people

REQ-13 ("admin creates a member account") is the first time the app does
something *on behalf of someone who isn't signed in*: an admin creates an
account for a member who has never touched HomeBase. That needs a
different key, a different kind of metadata, and a way to force the new
person to choose their own password before they see anything.

## Two keys, two jobs

| Key | Where it lives | What it can do |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | In the page, visible to everyone | Only what row-level security allows *for the signed-in person* |
| `SUPABASE_SECRET_KEY` | Vercel / `.env.local`, server only | Everything: bypasses RLS, creates and edits accounts |

[`lib/supabase/admin.ts`](../../lib/supabase/admin.ts) builds a client
with the secret key. It is only ever imported from Server Actions, and it
keeps no session of its own (`persistSession: false`) — it's a tool used
for one call, not an identity. If that key ever appeared in browser code
it would be the end of every guarantee in lessons 07–09, which is why the
name has no `NEXT_PUBLIC_` prefix and the file says so in a comment.

## Create, don't invite

Supabase offers two admin calls: `inviteUserByEmail()` sends a magic
link; `createUser()` creates the account and sends nothing. The
requirement is explicit — no email, the admin tells the person in
person — so it's `createUser()` with `email_confirm: true` (there is no
confirmation to wait for) and the temporary password the admin typed.
A test asserts `inviteUserByEmail` is never called.

## The signal has to exist before the account does

A Supabase account carries two bags of metadata:

- `user_metadata` — the person can change it themselves (their name).
- `app_metadata` — **only the secret key can write it.**

The first design used that asymmetry directly: the admin would set
`created_by_admin: true` in `app_metadata`, and REQ-10's trigger — which
fires *after* a row is inserted into `auth.users` — would accept any new
user carrying the flag. It failed on the very first try with "Database
error creating new user". Reading the Auth server's source explained
why: the admin API inserts the user row **first** and applies
`app_metadata` in a *second* statement inside the same transaction. The
trigger ran between the two, saw no flag, refused, and the whole
transaction rolled back. `user_metadata`, by contrast, is passed into
the insert itself — but anyone can set that, so it can't be trusted.

The fix is to write the trusted signal **before** the account exists.
The migration
[`20260918180000_admin_created_members.sql`](../../supabase/migrations/20260918180000_admin_created_members.sql)
adds a `member_invitations` table (one row per invited email, optional
role) that only `manage_members` holders may write — row-level security
enforces that, using the same `has_permission` gate as everything else.
The admin action inserts the invitation, *then* creates the account. The
rewritten trigger accepts a new user only if an invitation for their
email exists, grants the invited role (Member unless the admin chose
one), and deletes the invitation so it can't be used twice. No
invitation — as with any self sign-up — and it raises "Sign-up is
closed" exactly as before. If Supabase refuses the account for some
other reason, the action deletes the invitation it just wrote.

`app_metadata` still carries `must_set_password`, because that flag is
read later, from the login token, where post-insert is no problem.

## Two writes in a row need a plan for dying between them

Writing the invitation and creating the account are two separate calls to
two separate systems, and there is no transaction spanning both. The
action already handles the case where the second call *returns* an error:
it deletes the invitation it wrote. What it cannot handle is the process
simply stopping between them — a timeout, a dropped connection, a deploy.
Then the invitation stays, and an invitation was a permanent open door:
the proof was a row backdated by a day that still let that address sign
itself up through the public form (#52).

The answer isn't more cleanup code, which would have the same problem one
step further along. It's to make the leftover *harmless by default*:
invitations now carry `expires_at`, ten minutes out, and the trigger only
accepts one that hasn't expired. Ten minutes is far longer than the call
it covers and far shorter than an attacker's patience.

**Sweeping up is a separate job from being safe, and the live run taught
that the hard way.** The trigger also deletes expired rows when it runs —
but a *refused* sign-up raises an exception, and the exception rolls the
whole transaction back, cleanup included. The tidying only survives when
the sign-up succeeds. So the row that a refused attempt was supposed to
clear is exactly the row still sitting there afterwards. The sweep that
actually commits is the one in the admin action, which runs in a
transaction of its own before writing the next invitation; that is also
the moment it matters, because it's the admin's retry. The `expires_at`
test is the guard; everything else is housekeeping.

Two general shapes to keep. When a step can leave a record behind, prefer
making the record expire over promising to come back and tidy it up — a
guarantee that needs the process to still be alive isn't a guarantee. And
anything you do in the same transaction as a check that can fail will be
undone when it fails, so never let cleanup ride on a failing path.

Because these are real inserts into `household_members`, the guards from
REQ-12 apply to them: a third Admin is refused by the holder-limit
trigger, and a user with no membership row reads nothing. Both of those
criteria were structural-only until now; REQ-13's verification exercised
them with a second, real user.

## The forced password change rides in the token

The admin sets one more flag on creation: `must_set_password: true`,
also in `app_metadata`. Because `app_metadata` is copied into the login
token, the doorman from lesson 08 can see it on every request without
asking the database — so `proxy.ts` sends anyone carrying that flag to
`/set-password` and nowhere else (the routing rule in
[`lib/auth/routing.ts`](../../lib/auth/routing.ts) has the cases).

On that page the person sets a new password with their *own* session
(`updateUser`), then the server clears the flag with the secret key
(`updateUserById`) — and then does one more thing that is easy to
forget: `refreshSession()`. The token in the cookie still says
`must_set_password: true`; only a fresh token drops it. Without the
refresh the person would be bounced straight back to the page they just
finished.

## The temporary password is data, not a secret

The admin types it, reads it out, and it is replaced on first use. It
travels through a normal form field (not a password field — the admin
needs to see what they're about to say aloud) and is never stored by the
app; Supabase hashes it like any other password.
