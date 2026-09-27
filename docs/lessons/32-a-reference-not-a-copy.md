# 32. A reference, not a copy

Restaurants shows a place's name, photo, cuisine, hours and website, but
the database holds none of them. It holds one thing: Google's **place
ID**, a code like `ChIJ…` that means "this exact place" to Google.

## Why keep so little

Google's terms for Places say so: you may store the place ID, and must
ask Google for everything else when you show it. It also turns out to
be handy. A library card number never goes stale; a photocopy of the
book does. When a restaurant changes its hours or its website, we show
the new ones without doing anything.

The cost is that every screen asks Google. Two things keep that sane:

- **Ask only for what the screen shows.** Google bills a request by the
  most expensive field in it. A tile needs name, cuisine, area and a
  photo; only a place's own page asks for hours and website (the
  dearer fields). Each request says which fields it wants in a
  `X-Goog-FieldMask` header.
- **Let the phone remember photos.** Each photo Google hands out is
  charged. Our photo address answers "go to this Google image" with
  `Cache-Control: private, max-age=86400`, so the phone reuses it for a
  day instead of asking every time the list opens.

## The key stays on the server, even for photos

Asking Google for a photo takes the key. If the page's `<img>` pointed
at Google directly, the key would be in the page for anyone to copy. So
the image points at our own address, `/restaurants/photo?name=…`. The
server asks Google, Google answers with a plain image link that has no
key in it, and the server sends the browser there (a **302 redirect**:
"what you want is over there"). The route also refuses anyone signed
out, so strangers can't spend our Google allowance through it.

## Reading a link someone pasted

A maps link says which place it is in one of two ways:

1. **It carries the place ID.** Some Google links do (`query_place_id=`,
   `place_id:`, or `!19sChIJ…` deep in the address). Then there's no
   guessing.
2. **It carries a name and a spot on the map.** Most Google links
   (`/maps/place/Name/@lat,lng`) and every Apple link (`name=` and
   `coordinate=`, or `q=` and `ll=`). Then we ask Google's Text Search
   for that name near that spot and judge the answer: same name, within
   150 m, is confident; otherwise we show up to three nearby places.

Share links (`maps.app.goo.gl/…`, `maps.apple/p/…`) are just forwarding
addresses. The server opens them without following automatically
(`redirect: "manual"`), reads where each hop points, and stops unless
that is a Google or Apple maps address. That limit matters: a server
that fetches any address a user pastes can be steered at places it
shouldn't reach (the attack is called **SSRF**, server-side request
forgery). Ours only ever talks to maps hosts, five hops at most.

## Try it

- `lib/restaurants/links.test.ts` lists every link shape we read, and
  the ones we refuse (directions, searches, dropped pins).
- Open a place, then look at the network tab: the page's `<img>` asks
  `/restaurants/photo`, gets a 302, and loads from
  `googleusercontent.com`. Search the page for the key: it isn't there.
