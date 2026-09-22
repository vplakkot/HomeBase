# Lesson 14: Turning notifications on

REQ-20 ("opt in to push notifications") is the step between installing
the app (lesson 13) and actually sending anything (REQ-21). By the end
of it, a phone has said yes, and HomeBase knows where to reach it. Three
new pieces make that happen.

## The three pieces

**The question.** Only the phone can ask "Allow HomeBase to send you
notifications?", and an iPhone asks only when two things are true: the
app was opened from the home screen, not from a Safari tab, and the
question comes straight from a tap. So there's a button, "Enable
notifications", and asking is the very first thing the tap does. A test
checks that the question has been asked by the time the click handler
returns, before anything else has had a chance to run.

**The service worker.** [`public/sw.js`](../../public/sw.js) is a small
script the phone keeps running in the background, after the app is
closed. It's what receives a notification and puts it on the screen. A
device can't sign up without one, so the app registers it as soon as
it opens. (Since v0.2 the control itself lives in the account menu's
Settings; Home still runs the same check on every load, out of sight.)
It lives at the site's root because it only covers pages at or below
where it sits. Its tests run the file's own text against a
stand-in for the phone.

**The subscription.** When the phone says yes, its push service hands
back a *subscription*. For an iPhone, that push service is Apple's.
Think of the subscription as a delivery address at Apple's post office,
plus a padlock only this phone has the key to. It has three parts: the
address (`endpoint`) and two keys (`p256dh`, `auth`) that let a sender
lock a message so only this phone can open it. The app saves those
three to a new table, `push_subscriptions`, against whoever is signed
in.

## The app's own keys

Each subscription is also tied to HomeBase's own pair of keys, which
live in Vercel as environment variables:

- **The public key** (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) goes to the phone
  when it signs up. Apple remembers it.
- **The private key** (`VAPID_PRIVATE_KEY`) stays on the server. When
  REQ-21 sends, it signs each message with it, and Apple checks the
  signature against the public key it remembered.

It's a wax seal: anyone can recognise the pattern, only the holder of
the seal can make it. Nothing in REQ-20 uses the private key yet. It was
made now because the two must be created together, and a subscription
made with one public key only works with its matching private key.
Changing the pair later would mean every device signing up again.

Vercel only hands environment variables to a build, so after adding or
changing them, a new deployment is needed before the app sees them.
Until then the installed app says notifications aren't set up yet,
rather than breaking.

## What each person sees

| Where | What shows |
|---|---|
| A normal browser tab | How to install: Share → Add to Home Screen, then open it from there |
| The installed app, not asked yet | The **Enable notifications** button |
| After allowing | "Notifications are on for this device." |
| After denying | "Off", and the way back: Settings → Notifications → HomeBase → Allow Notifications |

Once someone says no, the phone never asks again, and no app can make
it. That's why the "off" message points to the Settings app instead of
offering the button again.

When saving fails, the person sees plain words, such as "This device is
already signed up for notifications under someone else in the
household", and the database's own message goes to the server log.

## The database's rules

Every member sees and manages only their own devices. Nobody else reads
them, admins included. Each rule also asks `is_member()`, like every
rule since lesson 09, and never a role's name. There's no `user_id`
in what the app sends: the database fills in whoever is signed in, so the
app can't save a device against someone else even by mistake.

One row per device, so a person can have several: a phone and an iPad
each get their own. The same device signing up again keeps the same
address, so the app refreshes its row rather than adding a second one.

The table also refuses any address that isn't a push service's own:
Apple, Google, Mozilla or Microsoft. REQ-21's sender will send a request
to every address in this table. Without the check, anyone with an
account could plant an address inside someone's network and have our
server call it. The check is in the database rather than the app, for
the same reason as the one-household rule: the app isn't the only way to
write to the table, and the database is.

## Signing out ends notifications on that device

A device belongs to whoever turned notifications on there. Leave it at
that and two things go wrong once REQ-21 starts sending: notifications
keep arriving on a device its owner has signed out of, and a second
person signing in on the same device can't turn notifications on,
because the address is taken.

Signing out now does three things in this order:

1. the browser tells the push service to forget this device, so nothing
   can be delivered here afterwards
2. the server removes that one row from `push_subscriptions`
3. the session ends

The order matters: removing the row needs the session that is about to
end, because the database only lets each person remove their own
devices. Their other devices are untouched, which matches sign-out
itself — it has always ended this device's session only. A clean-up that
fails is logged and signing out continues; being unable to tidy up must
never trap someone in a session.

How the app knows which device this browser is: when notifications are
turned on, the address goes into a cookie, `homebase-device`. It holds
nothing secret — an address is useless without the app's private key —
but it's `httpOnly`, so page scripts can't read or forge it.

Two guards around the same idea, both found in review:

- **Nobody is enrolled without tapping.** When the app opens and
  permission is already granted, it only confirms a device *this* person
  turned on, which the cookie says. Otherwise the next person to sign in
  on a shared device would find notifications already on, having never
  asked. They see the button instead.
- **Signing in clears the cookie**, since it describes whoever was here
  before.

And if an address is still taken — someone used the device and never
signed out — tapping Enable unsubscribes, signs up again for a fresh
address and saves that, instead of leaving a dead end.

Without JavaScript the form still signs out and the row still goes. Only
the push service's own copy would linger, with nothing left to send to
it.

## Checking the rules on the live database, without signing in

The rules above only exist in Postgres, so the tests in this repo can pin
their wording but can't run them. They were checked on the live database
instead, and without anyone's password.

The database decides who someone is from a setting on the connection,
`request.jwt.claims`, which normally comes from the sign-in token. A
test can set that itself and then switch to the `authenticated` role,
and the rules treat it exactly as they would that person. So one block
of SQL played the test member, then the test admin, then a signed-out
visitor, and tried every save, read, change and delete. At the end it
deliberately raised an error, and the error carried the results out.

That last part is the trick. Postgres undoes everything a failed
statement did, so none of the test rows survived, and a count straight
afterwards found none. It's a dress rehearsal on the real stage: the
lights, the set and the cast are real, and nothing is left on stage when
it's over.

| Attempt | Result |
|---|---|
| Member saves a phone and an iPad (two made-up device entries) | both saved, filed under the member |
| Member saves the phone again | refreshed, not duplicated |
| Member saves a device under the admin | refused by the rules |
| Member saves an address that isn't a push service | refused by the check |
| Admin lists devices | sees only their own |
| Admin changes or removes the member's devices | nothing changes |
| Admin takes over the member's phone by re-saving it | refused |
| Member removes their own iPad | removed |
| Signed-out visitor reads the table | permission denied |

The SQL is in [`supabase/checks/push_subscriptions.sql`](../../supabase/checks/push_subscriptions.sql),
so anyone can run it again:

```bash
npx supabase db query --linked -f supabase/checks/push_subscriptions.sql
```

It goes through the Supabase account already linked on this Mac. The
device entries are made up: this proves the rules, not that a real phone
can sign up.

## What only a phone can prove

The tests pretend to be a phone: they cover what the app does for each
answer, and what it saves. What nothing here can prove is the iPhone's
side: that the question appears, and that Apple hands back a working
subscription. This Mac has no iPhone simulator, and push needs a real
device anyway. It gets proven when REQ-21's first test notification
reaches a phone. "Each device receives its own notification" also moved
to REQ-21, because until something sends there's nothing to receive.
