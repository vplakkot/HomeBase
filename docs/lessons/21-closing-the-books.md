# 21. Closing the books

Batch 4 (#152) lets a month close. Three ideas came with it.

## 1. Closing is a photocopy plus a padlock

Think of a paper ledger an accountant signs off at month end. Two
things happen:

- **The photocopy.** Anything the month's figures depend on that could
  change later is copied onto the month itself. Here that's the split
  percentages (`month_people.percent`) and what each person still owed
  (`month_people.outstanding`). If someone edits next year's split, the
  closed month doesn't care: it reads its own copy (REQ-52).
- **The padlock.** From then on, nothing in the month may be written.
  That's a database trigger, `refuse_closed_month()`, on every table
  that belongs to a month. It runs before each insert, change or delete
  and refuses it if the month is closed.

Why a trigger, and not just hiding the buttons? Because a rule belongs
where the write happens (lesson 19). The buttons are hidden too, but
that only saves you a confusing error. The padlock is what makes it
true.

A padlock catches things you didn't plan for. Removing a bill from the
household's list quietly edits every month's copy of it (it empties
`bill_id`). The trigger lets that one through, because it changes no
figure. Removing a member is refused, because their payments would
vanish from a closed month.

## 2. Work that happens when nobody is looking

"A squared month closes at the end of that day" means something has to
run at midnight, with nobody there to click anything. The app only runs
when someone opens a page, so it can't be that. The database can:
`pg_cron` (already here for notifications, lesson 15) is an alarm clock
inside Postgres.

The catch is time zones. pg_cron's clock is UTC. Midnight in New York
is 04:00 UTC in summer and 05:00 UTC in winter. Rather than pick one
and be an hour off half the year, the job runs every hour and checks
"is it the hour after midnight in New York?" before doing anything.
That's a smoke alarm that beeps every hour but only acts when there's
smoke.

What this check can't prove from here: that the job really fires at
midnight. The live check (`supabase/checks/closing_a_month.sql`) proves
the job is scheduled and that closing does the right thing, but it
can't move the clock.

## 3. The same rule, written twice, on purpose

"Is this month squared?" is answered in two places:

- `monthStatus()` in TypeScript, for the chip on the page;
- `month_is_squared()` in SQL, for the midnight job, which runs without
  the app.

Two copies of a rule can drift apart, and that is the price. It's paid
down by writing both the same way (cents, the last person by `user_id`
takes the rounding cent), naming each other in their comments, and
testing both: the unit tests for the TypeScript, the live check for
the SQL (check 4 is exactly the rounding cent).

## Try it

1. In `closing_a_month.sql`, change check 17's percentages to 90/10
   and run it: January still owes the same. That's the photocopy.
2. Look at check 13: income can still be logged in a closed month that
   isn't over, because pay can land after a month squares early. A
   padlock with a deliberate side door.
