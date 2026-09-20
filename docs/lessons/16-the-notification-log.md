# Lesson 16: The notification log

REQ-21 made HomeBase send. REQ-22 asks the question that matters: did it
arrive? A week of hourly tests is only useful if something is writing
down what happened, because nobody is going to watch a phone all night.

## Three moments, not one

A notification has three moments worth recording, and they happen in
different places:

| Moment | Who knows it | How we find out |
|---|---|---|
| **Sent** | HomeBase | It just happened; write it down |
| **Arrived** | The phone | The phone has to tell us |
| **Tapped** | The phone | Same |

Only the first is free. The push service never reports back — handing a
message to Apple tells you Apple accepted it, not that a phone ever saw
it. That gap is the entire point of the requirement: "sent" and
"delivered" are different numbers, and the difference is the reliability
we're trying to measure.

So the phone reports in. The service worker, which is the part of
HomeBase that keeps running in the background, calls back the moment a
notification shows, and again when it's tapped.

## The problem: who is calling?

That call arrives with nobody signed in. A notification can land on a
phone whose owner signed out hours ago, and the service worker has no
page, no session and no cookies worth trusting.

We can't ask it to sign in, and we can't let just anyone say "that one
arrived" — a log that can be written by strangers is worse than no log,
because it would read as reassuring while being fiction.

The answer is a **receipt token**: a long random secret, different for
every notification, put inside the message itself. The message is
encrypted for one device, so only that device can read it. Sending the
token back is therefore proof of having received the message.

Think of it as a numbered ticket sealed inside the envelope. Anyone can
claim they got the letter; only the person who opened it can quote the
number.

**The log stores a hash of the token, not the token.** This is the same
reason a password is never stored as typed. An admin can read the log; if
it held the tokens, an admin could copy one out and quote it back,
recording a delivery that never happened — which is precisely the lie the
log exists to rule out. The receipt address hashes whatever arrives and
looks for a matching hash.

A plain SHA-256 is enough here, unlike a password. Passwords need slow,
salted hashing because people pick guessable ones. This is 256 random
bits, so there is no shorter route than trying them all.

What that buys, precisely:

- Someone with no token can do nothing at all.
- Someone with a stolen token can mark *that one* notification delivered,
  and nothing else. No reading, no other rows, no other people.
- Someone who can read the whole log still has no token.

One thing this does *not* buy, and it is worth naming rather than
glossing: the address is open to the internet with no rate limit, so
anyone can make the app do a little work for nothing. What they cannot do
is change anything they do not already hold a token for. Whether that
deserves a rate limit is a judgement recorded in the pull request, not
something the design quietly assumes away.

The address answers `204 No Content` every single time — for a good
token, a bad token, junk, anything. A different answer for a token that
matched would quietly turn it into a machine for testing guesses.

## Writing the row before sending

There's an ordering trap here that's easy to get backwards. The obvious
shape is: send the notification, then record what you sent.

That loses receipts. A push can reach a phone and bounce back in well
under a second — faster than the database write that was supposed to
create its row. The receipt arrives, finds nothing to attach itself to,
and is dropped. You'd see a delivered notification logged as missing,
and you'd never work out why.

So the rows go in **first** — hashes and all — and the send outcome is
written back afterwards. A test asserts the ordering directly, by
recording which happened first.

One honest wrinkle: for the fraction of a second between the two, a send
that is about to be refused is on record as accepted. If the app died in
that gap the row would stay slightly wrong — but it would show as
*missing* either way, which is the answer that matters.

## What the log does not keep

Not the device's push address.

That address is not an identifier, it's a capability: anyone holding it,
plus our keys, can send to that phone. The log keeps a **fingerprint**
instead — a one-way hash, twelve characters of it — which is enough to
tell two devices apart and follow one over time, and no use at all for
sending anything.

This also keeps the log inside the privacy line drawn by REQ-16 and
REQ-20, which deliberately hid switches and devices from admins too. The
log does show an admin that a particular person's device got a particular
notification, because the requirement asks for exactly that. It just
doesn't hand over the means to reach it.

A test asserts the SQL contains no `endpoint` column at all, so it can't
drift back in later.

## Missing is a judgement, not a fact

"No delivery after 5 minutes counts as missing" is worked out when the
log is read, not stored. Nothing sweeps the table marking rows.

That's deliberate. A stored flag would need a job to maintain it, could
disagree with the row next to it, and would have to be recomputed anyway
if the five minutes were ever tightened — which the requirement says it
will be. Working it out on read means the rule lives in one function,
`statusOf`, which takes a row and a clock and is tested at the boundary:
four minutes fifty-nine is waiting, five minutes is missing.

A send the push service *refused* is shown as refused, not missing.
Calling it missing would blame the phone for something that never left
the building.

Reliability is scored only against sends we already know the answer for.
Counting the ones still in flight as failures would make every fresh
send drag the number down for five minutes and then silently repair it.

## Tidying up after itself

Entries older than 30 days are deleted by a daily job, using the same
`pg_cron` that REQ-21 installed. It runs at 4:20am rather than on the
hour, so it never overlaps the hourly send.

Thirty days was a decision, recorded in the requirement: long enough to
judge reliability, short enough that a log we may throw away entirely
doesn't quietly become permanent.

## Proving the rules, without the key that ignores them

One gap nearly shipped, and it is the kind that hides well. Every test of
the log mocks Supabase, and every live check of the sender ran with the
**secret key** — which bypasses row-level security entirely. So nothing
had actually proven that a signed-in admin can read this table.

That matters because a policy which silently denies everyone looks
exactly like a log with nothing in it. Both show an empty screen.

[`supabase/checks/notification_log.sql`](../../supabase/checks/notification_log.sql)
closes it, using the same trick as the REQ-20 check: tell the database
who is asking, switch to the role a signed-in person actually has, try
everything, then raise an error so Postgres undoes it all. Against the
real project:

```
1. admin reads the log: sees 2 of 2 rows (wants 2)
2. admin cannot insert a row (wants this)
3. admin marked 0 rows delivered (wants 0)
4. member reads the log: sees 0 rows, including their own (wants 0)
```

Line 3 is worth reading carefully, because it is easy to credit to the
wrong thing. It shows the *policies* refuse a direct write — it would
report 0 even if the table stored raw tokens. What shows the hash
working is the other check: post the stored hash to the receipt address,
and nothing happens. Two different guards, and the log needs both.

## What was proven, and how

Against the real hosted database, with the app running:

- A signed-out caller reaches `/api/notifications/receipt` and gets
  `204`, while `/admin` redirects them to sign in — so the proxy skip is
  real, not just asserted in a test.
- Reporting a delivery wrote `delivered_at`.
- Reporting a tap afterwards wrote `tapped_at` **and left the original
  delivery time alone**, which is the "only fill a blank" rule working.

Not proven here: a real notification making the round trip from Apple to
an iPhone and back. That needs a phone with the app installed and the
member's switch on. The log exists precisely so that, when it happens,
nobody has to be awake to see it.
