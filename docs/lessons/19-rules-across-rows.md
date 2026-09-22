# 19. Rules that span several rows

## The problem

Most database rules are about one row: an amount must be positive, a due
day must be 1 to 31. Postgres checks those as each row arrives (a
`check` constraint), and refuses the row on the spot.

"The percentages for a budget year must total 100" is different. No
single row can break it or satisfy it: 60 is fine, 40 is fine, and only
the two together make 100. Check each row as it arrives and the first one
always fails, because its partner isn't in yet.

## Check at the end, not along the way

Analogy: a restaurant bill split between two people. The waiter doesn't
refuse the first card because it only covers 60%; they check the total
once both cards have been run.

Postgres does this with a **deferred constraint trigger**:

```sql
create constraint trigger budget_year_total_on_share
  after insert or update on public.budget_year_shares
  deferrable initially deferred
  for each row execute function public.check_budget_year_total();
```

`initially deferred` means "don't run this now; run it when the
transaction commits". By then every share is in, so the function sums
them and raises an error if the sum isn't 100. An error at commit undoes
the whole transaction: the year and all its shares, not just the last
row.

## Why the save is one database call

A deferred check only helps if all the rows arrive in the **same**
transaction. From the app, each `supabase.from(...).insert(...)` is its
own transaction, so inserting the year, then share one, then share two
would commit three times, and the second commit would already fail.

So the app makes one call, `supabase.rpc("save_budget_year", ...)`, a
database function that writes the year and every share together. A
function call is a single transaction: the check runs once, over the
whole set.

That function is `security invoker`: it runs with the caller's own
permissions, so the row-level security policies still decide whether
this person may save (lesson 09). `security definer` would have run it
with the owner's powers and skipped them.

## Belt and braces

The app checks the total too, and shows "The percentages add up to 90%.
They must total 100%." before bothering the database. That check is for
a friendly message. The database's check is the one that can't be
skipped: by a bug, a stale page, or a future screen that forgets.

## How it's proven

The unit tests mock Supabase, so they can't run the trigger. The live
check `supabase/checks/budget_year.sql` runs against the real database
as a real admin and member, and forces the deferred check early with
`set constraints all immediate`, because that script never commits (it
undoes everything at the end).
