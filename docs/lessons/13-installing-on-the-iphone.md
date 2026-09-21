# Lesson 13: Installing on the iPhone

REQ-19 ("installable as an app on iPhone") is what lets HomeBase sit on
the home screen, open like an app, and later send notifications. iPhones
only allow a web app to send notifications once it's been added to the
home screen, so this comes first. There's very little code in it, and
one trap.

## The app card

When you tap Share → Add to Home Screen, the phone looks for a small file
the site publishes about itself. Its official name is a **web app
manifest**; think of it as the app's card, like the label on a box. Ours
is [`app/manifest.ts`](../../app/manifest.ts), which Next.js serves at
`/manifest.webmanifest` and links from every page. It says:

| Field | Ours | What the phone does with it |
|---|---|---|
| `name`, `short_name` | HomeBase | The name under the icon |
| `icons` | 192 and 512 pixel PNGs | The picture on the home screen |
| `display` | `standalone` | Opens full screen, with no address bar or toolbar |
| `start_url` | `/` | Where the app opens: the home page |

iPhones also read a few lines from each page's `<head>`, which
[`app/layout.tsx`](../../app/layout.tsx) adds through Next.js's
`metadata`: a 180 pixel `apple-touch-icon` (the size iPhones use) and
the name to show under it. Opening full screen comes from the card's
`display: standalone`, not from the head. Older guides mention an
`apple-mobile-web-app-capable` tag. This version of Next.js writes only
the generic `mobile-web-app-capable` one, so the card is what counts.

The icons are PNG files in `public/`. Until v0.2 they were a placeholder
white house on dark blue. Since REQ-80 they are the design's icon, a
white roof over four module tiles, made from `docs/design/icon.svg` by
`scripts/export-icons.sh`. They're exported square, as DESIGN.md asks,
because iPhones round an app icon's corners themselves. A test reads
each file's width and height, and the colour of the pixels in its top
corners. A rounded export would show there, as see-through corners or
corners that aren't the icon's dark background.

## The trap: the phone fetches the card without your sign-in

Every page request passes through `proxy.ts` (lesson 08), which sends
anyone without a sign-in to `/sign-in`. Pictures skip it, because checking
a sign-in for a logo is wasted work, but the card is not a picture.

Browsers fetch the card the way a courier drops off a parcel: without
showing ID. By default they don't send cookies with that request, and the
sign-in lives in cookies. So even someone who is signed in would have
their phone ask for the card anonymously, the proxy would answer with the
sign-in page, and Add to Home Screen would ignore the card.

The fix is one entry in the proxy's skip list, next to `favicon.ico`.
That's safe because the card holds nothing private: it's the same for
everyone, and anyone could read it anyway. A test checks that the card and
the icons skip the proxy, and I confirmed in a browser that fetching them
with no cookies works while fetching the home page the same way still
bounces to sign-in.

One wrinkle you might meet: on Vercel **preview** links, Next.js adds
`crossorigin="use-credentials"` to the card's link, so the phone *does*
send cookies there. That is Next.js reacting to the *deployment type* —
it checks whether the build is a preview — and it still happens today.

What changed is that it no longer matters. Preview links used to sit
behind Vercel's own login, and without those cookies the card would have
been refused before it ever reached our app. Vercel's login is off now —
[lesson 15](15-sending-a-notification.md) explains why — so the cookies
the phone sends there are simply unused. The skip itself still matters,
on previews and on the real address alike.

## Staying signed in between opens

A cookie either has a lifetime or it doesn't. One without a lifetime is
thrown away when the app closes; v0.1's admin mode relied on exactly
that (lesson 10). The sign-in must not work that way, or every open of
the installed app would start at the sign-in page.

It doesn't: `@supabase/ssr` writes the sign-in cookies with a 400-day
lifetime, and writes them again with a fresh 400 days each time the
session is renewed, which the proxy does as you use the app. So in
practice you stay signed in as long as you open the app now and then.

That lifetime is the library's choice, not ours; it ignores any attempt
to change it. What our code can do is lose it on the way through, in
either of the two places cookies get written:

- **At sign-in.** [`lib/supabase/session-lifetime.test.ts`](../../lib/supabase/session-lifetime.test.ts)
  runs a real sign-in through our own Supabase client, with only
  Supabase's server faked, and reads what gets written.
- **At renewal**, in the proxy, about once an hour of use. A proxy test
  hands it a renewed cookie with a 400-day lifetime and checks the
  lifetime is still on what goes back to the phone, with and without a
  redirect.

Each fails if our code stops passing the lifetime along; I checked both
by breaking them on purpose. The sign-in test also fails if a library
update changes the lifetime itself. The renewal test was added in
review: the first version tested sign-in only, and dropping the
lifetime in the proxy passed every test.

One thing to expect on the phone: an installed web app keeps its own
cookies, separate from Safari's. Being signed in in Safari doesn't carry
over, so you'll probably sign in once inside the installed app. After
that it remembers you.

## What only an iPhone can prove

Everything above is tested on the parts we control: what the card says,
that the icons exist at the right sizes, that the phone can fetch them,
and how long a sign-in lasts. The last step can only be seen on an
iPhone: that it shows the icon and name, opens full screen, and keeps
you signed in between launches. This Mac has no iPhone simulator (that
needs Xcode), so that check had to wait for a real phone.

It happened at the v0.1 release on 2026-09-20: installed from the home
screen, signed in, and notifications enabled and arriving. That phone
installed the placeholder house. Not yet checked on a phone: whether an
app already on the home screen shows the design's icon without being
removed and added again.
