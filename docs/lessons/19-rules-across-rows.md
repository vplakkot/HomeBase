# 19. Rules that span several rows

## The problem

Most database rules are about one row: an amount must be positive, a due
day must be 1 to 31. Postgres checks those as each row arrives (a
`check` constraint), and refuses the row on the spot.

"The percentages in a split must total 100" is different. No
single row can break it or satisfy it: 60 is fine, 40 is fine, and only
the two together make 100. Check each row as it arrives and the first one
always fails, because its partner isn't in yet.

## Check at the end, not along the way

Analogy: a restaurant bill split between two people. The waiter doesn't
refuse the first card because it only covers 60%; they check the total
once both cards have been run.

Postgres does this with a **deferred constraint trigger**:

```sql
create constraint trigger split_total_on_share
  after insert or update on public.split_shares
  deferrable initially deferred
  for each row execute function public.check_split_total();
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

So the app makes one call, `supabase.rpc("save_split", ...)`, a
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
a friendly message. The database's check is the one a bug, a stale page
or a future screen can't skip when it saves a split.

One gap, on purpose: deleting a share isn't checked. When a person leaves
the household their share goes with them, and refusing that would block
removing them. So a split can be left totalling less than 100 until an
admin saves it again.

## How it's proven

The unit tests mock Supabase, so they can't run the trigger. The live
check `supabase/checks/budget_year.sql` runs against the real database
as a real admin and member, and forces the deferred check early with
`set constraints all immediate`, because that script never commits (it
undoes everything at the end).

## The same idea in money: the cent nobody owns

Payments toward a bill follow the same pattern (batch 3): one payment
on its own is fine, but together they mustn't come to more than the
bill. A trigger checks the sum whenever a payment is logged or changed,
and whenever the bill's amount changes, because lowering the bill is
the other door into the same broken state.

Splitting has its own across-rows rule: the two obligations must add up
to the bills exactly. Rounding each share on its own can break that:
$10.05 split 50/50 is $5.025 each, both round up to $5.03, and the two
come to $10.06 — a cent that was never spent, like cutting a cake in
half and ending up with a crumb too many. `monthTotals()` rounds
every share but the last, and gives the last person whatever is left,
so the crumb always lands on someone's plate and the sum is exact.

## A rule that spans two modules (Storage, #177)

Paperwork and Storage each have their own table, but one promise
belongs to both: an archived paperwork file sits in a **box**. A loose
suitcase can't hold a folder. That promise can be broken from either
side, so it's guarded from either side:

| Someone tries to… | Which table is written | Guard |
|---|---|---|
| archive a file into something that isn't a box | `paperwork_files` | trigger `refuse_file_outside_a_box` |
| untick "It's a box" while it holds files | `storage_entries` | trigger `refuse_unboxing_with_files` |
| remove a box that holds files | `storage_entries` | the file's link says `on delete restrict` |

It's the same shape as the payments rule above: find every door into
the broken state and put a guard on each, not just on the one you
thought of first. A shop with two entrances needs a security tag reader
at both.

The app asks first too, so people read "It holds 2 archived paperwork
files. Bring them back or archive them to another box first" rather
than a database error. That's the friendly message; the triggers are
the ones a stale page can't get round.

Proven after merge by `supabase/checks/storage.sql`, which tries all
three doors as a real member and undoes everything at the end.
