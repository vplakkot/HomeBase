# 29. Work after the answer

Reading a recipe from a video takes a minute or two. Nobody should have
to watch a spinner for that, so HomeBase splits the job: the phone
hands the video over and moves on, and the server finishes the work in
its own time. Two ideas make that possible.

## 1. Sending around the server, not through it

Our server runs on Vercel, which takes about 4.5 MB per request. A
recipe video is 50 to 100 MB. So the video doesn't come to us at all.

Think of a courier label. Our server holds the Gemini key (the
account). It asks Google for a **one-time upload link**: a prepaid
label good for one parcel of an exact size, and nothing else. The phone
sticks that label on the video and sends it straight to Google. The
key never leaves the server; the link is useless for anything but that
one file.

The video goes in **pieces** of 8 MB (Google asks for multiples of 8
MB). That matters on a phone: an iPhone pauses a web app a few seconds
after you switch to another app, and a web app, unlike a native one,
can't ask to keep uploading. With pieces, a pause costs at most one
piece. When HomeBase is back on screen, it asks how much arrived and
carries on from there, like a download manager resuming.

One surprise, found only by trying it in a real browser: once the last
piece lands, Google's answer is missing the header (CORS) that lets a
browser read a reply from another site. The upload worked; the browser
just isn't allowed to see the receipt. So the phone asks *our* server,
and our server asks Google. Servers aren't bound by CORS; it's a rule
browsers enforce to protect you from other sites' pages.

## 2. Finishing after answering

Normally a server action works, answers, and stops. Next.js's `after()`
lets it answer first and keep working:

```ts
after(async () => {
  await processVideoImport(createAdminClient(), importId);
});
return { done: true };
```

The phone gets its answer at once; the server then waits for Google to
process the video, asks Gemini for the recipe, saves the draft and
deletes the video. It's a restaurant taking your order and handing you
a buzzer: you sit down, the kitchen cooks, the buzzer goes off.

The buzzer here is the toast. Every page's frame checks every 15
seconds, but only while this browser has something on its way, and
says "Recipe ready" when the draft is in. The row in `recipe_imports`
is the order ticket: uploading → processing → ready or failed.

Because nobody is signed in "inside" `after()`, the job uses the admin
client (the secret key) to write its result. That key never reaches a
browser, and the job only touches the one row it was given.

## What can go wrong, and what we do

- **The server stops mid-job** (a deploy, a time limit): the row would
  sit at processing forever. So a row processing for over 10 minutes is
  marked failed the next time anyone's toast asks.
- **Gemini finds no recipe**: it's told to answer `found: false` rather
  than invent one, and the draft screen says so plainly and offers the
  card to fill in by hand.
- **Google hiccups**: its status check sometimes answers 500 while a
  video is processing. That counts as "not yet", not as a failure.

That's why the video path wears a permanent BETA label: three outside
steps (upload, processing, reading) that we don't control, each allowed
to fail without losing anything but the attempt.

## Pictures skip the upload link

A recipe from pictures (REQ-157) uses the same buzzer but not the side
door: a phone shrinks each picture to a few hundred kilobytes, so all of
them fit in one request through our server. The row starts at
processing, `after()` hands the pictures to Gemini directly, and they
are forgotten once read. Rule of thumb: go around the server only for
what can't fit through it.

## Choosing a photo from a video we never receive

Gemini watches the video, so it can say *when* the finished dish is on
screen, but it answers in words: it can't hand back a picture. Cutting
the picture needs the video file, and the only place that has it is the
phone that sent it (Google won't give it back, and our server never held
it). So the phone keeps the file in memory, and once the recipe is ready
it cuts the frame at the second Gemini named. It's an architect who
tells you which window to photograph, while only you hold the camera.
The catch is plain: close HomeBase first and there's no camera, so the
card gets no photo, and the draft says so.

## A page is a photograph, not a window

A server-drawn page is a photograph taken when it was opened. The Meal
Plan overview said "Sending the video" because that is what was true
at the moment of the photo. The toast at the bottom is different: it
keeps asking the server, like a window. After a phone screen lock the
window showed "Recipe ready" while the photograph still said "Sending"
(REQ-167). Two things on one screen, two different ages.

The fix isn't to make the photograph poll too. The toast already
knows when what it hears has changed, so it just says so (an event in
the browser), and the Meal Plan page, which was listening, takes a new
photograph (`router.refresh()`). One thing asks the server; everything
else follows it. Not every change counts: the first answer, or the same
answer again, redraws nothing.
