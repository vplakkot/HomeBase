# 24. Numbers that never come back

Paperwork files carry a printed label: `F-0042 · Taxes`. Once that
sticker is on a folder, the number has to mean that folder forever. This
lesson is about how the database keeps that promise, and about the two
ways a row can refuse, or survive, the removal of something it points at.

## A ticket machine, not a count

The obvious way to number files is "count the files, add one". It
breaks the moment a file is removed: with files 1, 2 and 3, removing 3
and counting again hands out 3 a second time, and now two folders in
the house have the same sticker.

A deli ticket machine doesn't count the people waiting. It just hands
out the next ticket, and a ticket that was torn off and thrown away is
never printed again. Postgres has exactly this, called an **identity
column**:

```sql
number bigint generated always as identity unique
```

- *identity* — the database keeps its own counter and takes the next
  value for every new row.
- *generated always* — nobody else may pick the number. An insert that
  names one, or an update that changes one, is refused.
- The counter only moves forward. A removed file's number is gone for
  good; so is a number taken by an insert that then failed. Gaps are
  fine: the promise is "never reused", not "no gaps".

The app shows the number padded, `F-0042`, but stores the plain number.
Padding is how it looks, not what it is (`fileId()` in
`lib/paperwork/paperwork.ts`).

## When the thing you point at goes away

A foreign key says "this row points at that one". It also says what
happens when *that one* is deleted. Paperwork uses two answers:

| Link | On delete | Why |
|---|---|---|
| file → category | `restrict` | Removing a category that files still use is refused. The admin must move those files first, so no file is ever left without a category. |
| paper → file | `set null` | Removing a file doesn't lose its paperwork: each paper goes back to Unfiled, and Home asks someone to file it again. |

Think of a library. You can't close a section while books still sit on
its shelves (`restrict`). But if a single shelf is taken down, its books
go back on the returns trolley rather than into the bin (`set null`).

The app asks the same question before the database does. Removing a
category that's in use shows "Move its 2 files to…" and only then moves
and removes. The database rule is still there for the case the screen
didn't foresee, which is the lesson from batch 1: put the rule where the
write happens, not on the button.

## How it was checked

There's no database on this laptop, so these rules are proven against
the real project after merge with `supabase/checks/paperwork.sql`: it
tries to pick a number, change a number, reuse a removed number and
remove a category in use, reports what happened, and undoes everything.
