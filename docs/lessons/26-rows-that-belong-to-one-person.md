# 26. Rows that belong to one person

Until Drinks, every row in HomeBase was the household's: any member
could add, change or remove any bill, document or box. A star rating is
different. It's *my* opinion. You can read it, but you mustn't be able
to change it, and I mustn't be able to rate for you.

## The analogy

Think of a guest book with one page per wine. Everyone can read every
page. Each of us has our own line on each page, and a pen that only
writes on our own line. Writing on the line again crosses out what was
there; there's never a second line for the same person.

## One line each: the primary key

`drink_ratings` has no id column. Its primary key is the pair
`(drink_id, user_id)`: the database refuses a second row for the same
person and drink. So "one rating per person per drink" isn't something
the app has to remember. It's impossible to break.

Rating again is an **upsert** ("update or insert"): the app says "save
this row, and if one with the same key already exists, overwrite it"
(`onConflict: "drink_id,user_id"`). The same request works for a first
rating and a changed one.

## Only your own pen: `auth.uid()`

Row-level security (lesson 9) so far asked *what* you're allowed to do:
`has_permission('use_modules')`. Ratings also ask *whose row it is*:

```sql
create policy "members change their own rating"
  on public.drink_ratings for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()))
  with check (user_id = (select auth.uid()) and ...);
```

`auth.uid()` is the id of whoever is signed in, read from their session,
not from anything the app sends. So even a hand-made request can't touch
someone else's row:

- `using` decides which existing rows you can see *to change*. Someone
  else's rating simply isn't there for your update or delete: it
  affects zero rows, no error.
- `with check` decides what the row may look like *after* your write.
  It stops you inserting a row with someone else's `user_id`, or moving
  your own row to theirs.

Reading stays open to every member, because everyone's rating is shown
by name.

## The clock is the database's

"Changed 21 Sept" comes from `updated_at`. A trigger sets it to `now()`
on every insert and update, whatever the app sends, so a rating's date
can't be wrong or faked.

## Where to look

- `supabase/migrations/20260926100000_drinks_and_ratings.sql`: the
  table, its key, its four policies and the trigger.
- `app/drinks/actions.ts`: `rateDrink` (the upsert) and `clearRating`.
- `supabase/checks/drinks.sql`: signs in as the Member, rates, then as
  the Admin tries to change it, and shows the rating unchanged.
