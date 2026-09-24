# Lesson 15: Sending a notification

REQ-20 got a phone to sign up. REQ-21 is the other half: something that
actually sends, every hour and on demand, so we can find out whether push
is reliable enough to build on.

## Who is involved

Three parties, and the app only ever talks to the middle one.

| Who | Does what |
|---|---|
| HomeBase | Writes the message, seals it, hands it over |
| The push service (Apple's, for an iPhone) | Delivers it, or holds it until the phone is reachable |
| The phone | Opens it and shows the notification |

It works like posting a sealed letter. We hand Apple an envelope we've
locked with the phone's own key, stamped with our seal. Apple can see the
address and the stamp, carries it, and can't read a word of it. That's not
a nicety: Apple would otherwise be reading every household reminder we
ever send.

Two pieces of cryptography do that, and
[`web-push`](https://www.npmjs.com/package/web-push) does both for us:

- **The stamp.** Each request is signed with the app's private key, the
  one you put in Vercel. Apple checks it against the public key the phone
  handed over when it signed up (lesson 14). That's how Apple knows the
  message really comes from HomeBase.
- **The lock.** The message is encrypted with the two keys that came back
  with the subscription, which only that one device holds.

We took the package rather than writing this ourselves. Hand-rolled
cryptography is the classic example of code that looks right, passes your
tests and is quietly broken.

## Who gets one

Everyone whose switch is on (REQ-16), and every device they've signed up
(REQ-20). Both of those are private to their owner: members can't read
each other's switches or devices, and admins can't either. A job running
on a schedule has nobody signed in at all, so it reads them with the
secret key, which is the only route to them. Both requirements said this
would be needed; this is where it lands.

Two rules fall out of that:

- **Switched off means nothing is sent.** The query asks for the switched-on
  people first, and only then for their devices. A switched-off member's
  devices are never even fetched.
- **A dead address is forgotten.** If a push service answers `404` or
  `410 Gone`, that device's row is removed. Otherwise the table would
  slowly fill with addresses nothing can be delivered to, and every hour
  would retry them for ever.

One device failing never stops the others: each send is its own attempt,
and the summary counts what got through.

## The clock lives in the database

Vercel's free plan only allows a *daily* scheduled job, and this needs an
hourly one. So the timekeeping moves to Supabase, which can do it:
`pg_cron` keeps the time, and `pg_net` lets the database make a web
request. On the hour, the database calls the app's own address, and the
app does the sending.

```
every hour → Supabase (pg_cron) → calls HomeBase → web-push → Apple → phone
```

That address has to be reachable without signing in, because the database
isn't a person and has no session. So it proves itself with a shared
secret instead: the same value sits in Vercel, which the app reads, and in
Supabase's vault, which the schedule reads. Neither is in git. The address
is in the vault too, so it can change without a migration.

The secret is compared **in constant time**. A normal comparison stops at
the first wrong character, and the time it takes would let someone guess
the secret one character at a time.

Until both vault entries exist, the hourly job runs and deliberately does
nothing, rather than failing noisily every hour.

The two vault names are matched **exactly, capitals included**. A secret
saved as `NOTIFY_SECRET` is not `notify_secret`: the guard above finds
nothing, and the job does nothing, every hour, without complaint. That
happened on the first attempt here.

## Vercel's own front door had to be unlocked

Vercel can keep every deployment behind *its* login, a setting called
Deployment Protection, and it was on. It turns callers away before they
reach our code: the database's call was answered by Vercel's sign-in page,
not by HomeBase.

It would have shut out the household too. Megan can't sign in to Vercel —
it isn't her account — so she could never have reached the app at all. So
it was switched off. On this plan that's all or nothing; there's no
setting that protects previews alone.

What really guards HomeBase is its own sign-in, which is invite-only.
Vercel's was a second lock only one person held a key to. The price of
removing it: preview links are now reachable by anyone holding the URL,
though every page behind them still demands a HomeBase sign-in.

## How to tell whether the hourly job ran

Nothing reports back. `pg_net` sends the request and forgets it, so a job
that fails — a secret that doesn't match, an address that isn't live yet
— fails silently, every hour, for ever. The answers are kept in the
database for a few hours, so this is how to look:

```sql
select created, status_code, content
from net._http_response
order by created desc
limit 5;
```

`200` with a count of what was sent is a working hour. `401` means the
secret in Vercel and the one in the vault don't match — a stray newline
is enough. `307` pointing at `/sign-in` means whatever `notify_url`
points at is running code that has the sign-in proxy but not this
address — most likely its build hasn't finished. `404` means that code
is older still, from before this route existed at all, which is what
production answers until v0.1 ships. Nothing at all means the schedule
never ran.

To compare the two copies of the secret without ever looking at either,
fingerprint them. The database side:

```sql
select name, encode(extensions.digest(decrypted_secret,'sha256'),'hex')
from vault.decrypted_secrets;
```

and the Vercel side, by pulling the production values to a scratch file,
hashing the same way, and deleting the file. Matching fingerprints mean
matching secrets; a printed secret is one you then have to go and rotate.

## A trap found by clicking the button

The push services refuse a contact address that isn't `https:` or
`mailto:`. On this laptop the app's own address is
`http://localhost:3000`, so the first click of "Send test now" failed with
exactly that message. The sender now writes such an address as `https`.
Nothing fetches it — it's a note saying which app is calling — but the
rule is strict.

Worth remembering: the unit tests all passed while this was broken,
because they used a stand-in for the library. Clicking the real button
against the real database found it in seconds.

## What's proven

Proven by the tests: who would be sent to, that a switched-off member is
never included, what the message says, that a dead address is forgotten,
that the schedule's address refuses anyone without the secret, and —
using the real library, not a stand-in — that what would go to Apple is
signed with our keys and encrypted so the body can't be read.

**Proven by the release, on 2026-09-20:** a notification actually
arrives. The hourly job ran at 17:00 UTC, reported
`{"people":1,"devices":1,"delivered":1,"failed":0}`, and the phone
showed it. Nobody triggered it and nobody was watching for it. The hour
before, with nothing enrolled, the same job reported all zeros — so the
counts mean what they say.

That was the open question of the whole milestone, and it is closed. One
device, one install, one real notification.

What the week of hourly tests answers now is a different question, and a
narrower one: not *can* push deliver, but *how often does it*. One
notification proves the path exists. Only repetition finds the gaps.

## Which address the schedule calls, and why it matters

The hourly job calls whatever sits in the vault as `notify_url`. Today
that is `home-base-home-base12.vercel.app` — which is **not**
production. It is the address that follows the newest build of `main`.
Production is `home-base-peach.vercel.app`, and it only moves when a tag
is pushed. [Lesson 03](03-tags-releases-promote.md) has the three kinds
of address and the trap in telling them apart.

That is why the job started answering `200` well before v0.1 shipped,
and it should be said plainly that this was a mistake rather than a
plan: the address was chosen while the wrong one was believed to be
production.

It turns out useful by accident. It means the whole chain — database
clock, HTTP call, secret check, sender — gets exercised for real every
hour before the release, which is how we know it works rather than
hoping.

**It has to move before the test week counts for anything.** Not for a
mechanical reason — both deployments share the same push keys and the
same database, so either could reach a phone that signed up through the
other. The reason is what the week is for: it asks whether push is
reliable enough to build on, and the answer has to be about the thing
the household actually uses. When v0.1 ships, `notify_url` becomes:

```
https://home-base-peach.vercel.app/api/notifications/test
```

Not before. Production is still serving v0.0.5, which has no such
address, so moving it early just means an hourly `404`.

(Since 2026-09-24 the hourly test is gone and `/api/notifications/test`
with it. The Finances reminders read only the host part of `notify_url`,
so the path left in the vault no longer matters.)
