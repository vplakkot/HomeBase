# 20. Rows with a life, instead of rows you rewrite

## The problem

Vin, looking at the Budget year screen: "I should be able to change % mid-year
as salary changes ... doesn't mean change everything backwards."

The obvious way to store a percentage is one row you edit: change 67 to
70 and save. That works right up to the moment something else has already
used the old value. September was split 67/33. If October's raise edits
that row, September silently becomes 70/30 too — the bills it settled no
longer add up, and nobody asked for that.

The same trap sits under a paycheck amount. Edit the amount and every
payday the app ever worked out from it changes with it.

## The shape that fixes it

Give the row a life instead of a value you overwrite:

- It **starts** on a date. A split has `effective_from`; an income source
  has `effective_from`.
- It may **end**. An income source has `ended_on`. A split doesn't need
  one: the next split starting is what ends it.
- Nothing in the past is ever **rewritten**. Changing something means
  adding the next row, not editing the last one.

Analogy: a pay stub. You don't correct April's stub when you get a raise
in May; you get a new stub. The old one stays true about April.

So "what is the split?" stops being a lookup and becomes a question about
a date:

```ts
// The latest split that had started by then.
splits.find((split) => split.effective_from <= monthStart(day));
```

And changing an income source is two writes in one transaction — end the
old, start the new — which is why it lives in a database function
(`change_income_source`), not two calls from the app.

## Then stop offering the edit

Storing history is half of it. If the screen still shows Edit on a split
that has already started, someone will use it and the app will do exactly
what this design was meant to prevent.

So a split that has begun shows neither Edit nor Remove, and says why:
"Already started, so it stays as it is. Add a split to change things from
a later month." The server refuses it too — screens can be stale, and the
rule matters more than the button.

## Two things to settle early

**Which clock.** `current_date` in Postgres is the server's day, in UTC.
For four hours each evening that is tomorrow in New York. Every date in
Finances comes from `householdToday()` instead and is passed into the
database, so a source ended at 9pm is ended today, not tomorrow.

**Which end is inclusive.** Ours: a source counts on a day when
`effective_from <= day` and (`ended_on` is null or `day < ended_on`).
`ended_on` is the first day it no longer counts, so the source that ends
and the one that replaces it, both stamped the same day, hand over with
no day counted twice and none missed. Write the convention down; every
later query depends on reading it the same way.
