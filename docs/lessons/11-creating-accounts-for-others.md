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

## `app_metadata` is the trust boundary

A Supabase account carries two bags of metadata:

- `user_metadata` — the person can change it themselves (their name).
- `app_metadata` — **only the secret key can write it.**

That asymmetry is what lets the database tell an admin-created account
from a self sign-up. The migration
[`20260918180000_admin_created_members.sql`](../../supabase/migrations/20260918180000_admin_created_members.sql)
rewrites REQ-10's trigger: the very first user still creates the
household and becomes Admin; after that, a new account is accepted only
if its `app_metadata` says `created_by_admin: true`, and it gets the
Member role unless a `household_role` was chosen. A self sign-up can't
forge that flag, so "sign-up is closed" still holds exactly as before.
The role default sits in SQL as data; app code still names no roles.

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
