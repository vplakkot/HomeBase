# 30. One open plan, and counting instead of keeping a tally

The week's plan (REQ-115) brought two small database ideas. Both are
about letting the database hold a rule, so the app's code can't forget
it.

## 1. "Only one open plan" is the database's rule

There is one plan at a time. The plain way to enforce that is in the
app: before starting a plan, look for an open one, and refuse if there
is. That has a gap. Two phones can look at the same moment, both see
"none open", and both start one. Now there are two plans, and the app
doesn't know which is real.

Think of a single key to the shed hanging on a hook. Asking "is anyone
in the shed?" and then walking over leaves time for someone else to do
the same. Taking the key settles it: whoever has it is in, and nobody
else can take it.

The database's version of the key is a **partial unique index**:

```sql
create unique index meal_plans_one_open on public.meal_plans ((true))
  where closed_at is null;
```

Read it as: among plans that aren't closed, the value `true` may appear
once. Every open plan has the value `true` there, so a second open plan
is a duplicate and Postgres refuses it, however close together the two
requests arrive. Closed plans are outside the `where`, so any number of
them can pile up as history.

The app still has something to do: the refusal arrives as error code
`23505` ("unique violation"), and `startPlan` turns that into plain
words: "A plan is already open. Refresh to see it." The same code
catches adding one recipe to a plan twice, which the table's primary
key `(plan_id, recipe_id)` refuses.

## 2. Counting instead of keeping a tally

A recipe card shows "times planned" and "last planned". One way is a
tally: a `times_planned` column that goes up by one when a recipe joins
a plan. But then every way a recipe leaves a plan has to remember to
take one off: removing it, removing the whole plan, a mistake fixed by
hand. Miss one and the tally is wrong, quietly and for good.

So nothing is stored. The rows that say "this recipe is in this plan"
are already the record; `readPlanStats` counts them and takes the
latest start date each time a page asks. Take a recipe off a plan and
its count is right straight away, because there was never a second
copy of the fact to update.

Think of a guest book. You could keep a separate note saying "37
visitors", or you could count the signatures. The note can drift; the
signatures can't.

The cost is a little work on every read. For a household's recipes
that's nothing. If it ever mattered, a database view could do the
counting, and it would still be counting rather than a tally.

## The same thinking in scaling

Scaling a recipe (REQ-113) follows the same idea from the other side.
The browser works out the scaled card to show you, but when you save,
it sends only the ratio ("1.5 times"). The server reads the stored card
and scales it again with the same code (`lib/meal-plans/scale.ts`). The
browser never gets to write amounts the server didn't work out itself,
so there's one source for the numbers, not two to keep in step.
