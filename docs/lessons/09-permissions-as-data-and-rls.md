# Lesson 09: Permissions as data, and locks that check for keys

REQ-12 ("roles and household stored as data") adds no screens. It changes
*who decides* what a person may do — the database — and *how* that
decision is phrased: by permission, never by role name.

## Keys, not job titles

Two ways to write an access rule:

- "Is this person an Admin?" — a **role-name check**. Every rule knows
  the list of roles. Add a role tomorrow and every rule needs revisiting.
- "Does this person hold the `manage_members` key?" — a **permission
  check**. Rules know nothing about roles. A new role is rows: one in
  `roles`, some in `role_permissions`. Nothing else changes.

HomeBase uses the second form everywhere, and a test
([`lib/auth/no-role-names.test.ts`](../../lib/auth/no-role-names.test.ts))
scans the app for the first form and fails if it finds one. The only
place a role is picked by name is the migration that hands out the seed
keys — data, not a rule.

The keys so far: `use_modules` (both roles), `manage_members` and
`manage_roles` (Admin only). Adding a key means adding a rule that asks
for it, so keys are the one thing that *is* code-shaped; roles are not.

## Row-level security: the database refuses, not the app

Lesson 07 switched RLS on with no policies — every door locked, no keys
cut. This migration cuts the keys, as **policies**:

- *Any member can read everything* (`households`, `roles`,
  `role_permissions`, `household_members`). That is the "all household
  data is fully shared" criterion, written once per table.
- *Changing memberships needs `manage_members`; changing roles or their
  permissions needs `manage_roles`.*

A policy is a `where` clause the database staples onto every query that
role sends, whoever wrote the query. A signed-in person outside the
household — or nobody signed in at all — matches none of the "member"
rows, so `select * from households` returns nothing rather than an
error. The app never has to remember to filter; it *can't* forget.

Two helper functions do the asking, so the policies stay one line each:

```sql
is_member()                 -- does the caller belong to the household?
has_permission('manage_x')  -- does the caller's role carry this key?
```

Both are `security definer` with an empty `search_path` (see lesson 07
for why). They read `household_members` and `role_permissions` — tables
the caller may not be allowed to read directly — on the caller's behalf,
and answer only true or false. The policies call them as
`(select public.is_member())` rather than `public.is_member()`: that
form lets Postgres evaluate the helper once per query instead of once per
row.

The same `has_permission` is callable from app code over RPC
([`lib/auth/permissions.ts`](../../lib/auth/permissions.ts)), so a page
can decide what to *show* using exactly the rule the database uses to
decide what to *allow*. The home page's "You can manage members." line is
the first use.

## Two admins, as data

"At most two Admins" is not written as a rule about Admins. `roles` gains
a `max_holders` column (2 for Admin, empty for Member), and a trigger on
`household_members` refuses any membership that would push a role past
its limit. Change the number, or set one for a future role, and the
trigger already enforces it.

## What could and couldn't be checked live

With the migration applied, signing in over the API as the test admin
and reading `households` returns the row; the same read with no session
returns nothing; `has_permission('manage_members')` is true for the
admin. An anonymous attempt to insert a role came back `401` with
Postgres's own `42501: new row violates row-level security policy` —
the database refusing, not the app. And the admin, holding
`manage_roles`, added a throwaway "Helper" role and its permission row
over the API, saw it listed beside Admin and Member, and deleted it
again — a new role handled entirely as data, with no code involved. Two criteria stay structural for now: a signed-in *non-member*
and a third Admin. Neither can exist yet — REQ-10's trigger refuses
every self sign-up after the first — until REQ-13 lets an admin create
accounts. The migration tests pin the policies and the trigger in the
meantime, and REQ-13 is where those two get their live check.
