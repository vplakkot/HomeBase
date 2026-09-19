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
device can't sign up without one, so the app registers it as soon as it
opens. It lives at the site's root because it only covers pages at or
below where it sits. Its tests run the file's own text against a
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

Each subscription is also tied to HomeBase's own pair of keys, which is
what you added to Vercel:

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
| Member saves a phone and an iPad | both saved, filed under the member |
| Member saves the phone again | refreshed, not duplicated |
| Member saves a device under the admin | refused by the rules |
| Member saves an address that isn't a push service | refused by the check |
| Admin lists devices | sees only their own |
| Admin changes or removes the member's devices | nothing changes |
| Admin takes over the member's phone by re-saving it | refused |
| Member removes their own iPad | removed |
| Signed-out visitor reads the table | permission denied |

Run with `npx supabase db query --linked -f <file>`, which goes through
the Supabase account already linked on this Mac.

## What only a phone can prove

The tests pretend to be a phone: they cover what the app does for each
answer, and what it saves. What nothing here can prove is the iPhone's
side: that the question appears, and that Apple hands back a working
subscription. This Mac has no iPhone simulator, and push needs a real
device anyway. That check is yours, on a phone, and REQ-21's first test
notification is its natural end point. "Each device receives its own
notification" also has to wait for REQ-21, because until then nothing
sends.
