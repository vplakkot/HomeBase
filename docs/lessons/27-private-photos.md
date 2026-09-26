# 27. Private photos

Label photos are the first files HomeBase keeps. Files don't go in the
database's tables; they go in **Supabase Storage**, which comes with the
same project. Three ideas make it work.

## 1. A private bucket, guarded like a table

Storage keeps files in **buckets**, like folders. A public bucket gives
every file an address anyone can open. Ours, `drink-labels`, is
private: no address works on its own.

Behind the scenes, each file has a row in a table called
`storage.objects`. That means the row-level security from lesson 9
works on files too:

```sql
create policy "members read drink labels"
  on storage.objects for select to authenticated
  using (bucket_id = 'drink-labels' and (select public.is_member()));
```

So "visible only to our household" is enforced by the same rules as a
bill or a rating.

## 2. Signed links: a key that expires

A private photo still has to show in an `<img>`. The server, signed in
as you, asks Storage for a **signed link**: the photo's address plus a
code that says "let this through for an hour". Anyone holding the link
can see the photo until it expires, then it's dead.

Think of a hotel key card. The hotel (Storage) doesn't give you the
building; the front desk (our server) checks who you are, then hands
you a card that opens one door and stops working at checkout.

## 3. Shrink before sending

A phone photo is 3–12 MB. Sending that over a shop's weak signal is
slow, and storing it is wasteful. So the browser shrinks it first, on
the phone, with a `<canvas>`: draw it at most 1600 pixels on its long
side, save as JPEG, and if it's still over 450 KB, save again at lower
quality until it fits. A worst-case 11 MB test photo came out at 393
KB, plus a 12 KB copy for the list.

## The camera opens only from a tap

A web page can't open the camera whenever it likes: the browser allows
it only as the direct result of a tap, like a lift button that only
works while you're pressing it. So the header's Scan opens the camera
on the page you're on, with no scan screen in between. The scan screen
arrives after the photo is taken, and the photo is handed over the way
you'd hand someone a note on the way through a door: a variable in the
browser's memory ([`app/drinks/scan/pending.ts`](../../app/drinks/scan/pending.ts)).
Moving between pages in a Next.js app doesn't reload the scripts, so
the note is still there when the scan screen looks for it; a full
reload loses it, and the scan screen then offers the camera itself.
The same rule is why Add back label and Retake open a picker right away:
each is a tap.

## Order matters

Saving a scanned drink touches two places: Storage and the `drinks`
table. They can't be saved in one step, so the action goes in the order
that's easiest to undo:

1. make the drink's id first (`crypto.randomUUID()`),
2. upload the photos under that id,
3. save the row with where they are.

If the upload fails, nothing was saved. If the row fails, the uploads
are removed. Either way you never get a drink pointing at a missing
photo.

## Where to look

- `supabase/migrations/20260926140000_drink_label_photos.sql`: the
  bucket and its four policies.
- `lib/drinks/shrink-photo.ts` and `lib/drinks/photos.ts`: shrinking
  and signed links.
- `app/drinks/actions.ts`: `addDrink`, `setPhotos`, `removeDrink`.
- `supabase/checks/drink_photos.sql`: proves someone outside the
  household sees nothing.
