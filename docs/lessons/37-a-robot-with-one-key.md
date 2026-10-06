# Lesson 37: A robot with a key to one folder

Paperwork can now keep a File in Google Drive. The app has to open that
folder without anyone signing in to Google each time. That is what a
**service account** is for.

## Think of a house-sitter with a key to one room

You don't hand over your own keys (your Google password). You cut a new
key that opens exactly one room (the one folder you shared) and give it
to a house-sitter (a robot with its own email address). The robot has no
password to forget and no login that expires. Take the sharing away and
the key opens nothing.

1. In Google Cloud we made the robot and downloaded its **key file**: a
   small JSON with the robot's email and a private key.
2. In Drive we shared the HomeBase Paperwork folder with the robot's
   email as **Editor**. Sharing is the whole permission.
3. In Vercel the key file lives as `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`,
   never in git. Vercel boxes like a single line, so the app accepts the
   file as it is or base64 of it.

## Proving who we are without a library

To use the key, the app signs a short note ("I am this robot, I want
Drive, this is valid for an hour") with the private key and sends it to
Google, which answers with a token. Every Drive request then carries the
token. That is a **JWT** (a signed note); Node can sign one in a few
lines with `crypto`, so there is no Google library to install, update and
trust. See `lib/paperwork/drive.ts`.

## Test the permission before building on it

"Editor" sounds like it can do everything, but personal Drives have
quirks. The first task of this batch was to try, against the real folder,
the three things the screens would need: move a document between folders,
move a folder, rename a folder. All worked, so all three got buttons.
(What didn't: the robot can't *create* a document, because it has no
storage of its own. The app never needs to.) Had one failed, the plan was
to build no button for it. Trying first is cheaper than building a button
that always errors.

## Link by ID, copy what you saw

A folder's name can change; its **Drive ID** never does. A File is tied
to its folder by ID, and the name is only a mirror for people browsing
Drive. HomeBase also keeps a copy of what it last saw (names, who owns
each, whether it is gone), so pages open fast and a document Drive has
lost can say "Missing" instead of vanishing.

- **Ask Drive first, then update the copy.** If Drive refuses a move,
  nothing in HomeBase changed, so the two can't disagree because of a
  refusal.
- **Gone isn't deleted.** A document missing from a sync is marked
  Missing, and only the admin removes the record. A bad sync (say, the
  folder was unshared) must never quietly erase records, so a sync that
  can't see the connected folder says so and marks nothing.
- **The app is the source of truth for names.** A folder that doesn't
  match gets a Fix button that renames it in Drive, and renaming a
  category renames its folders. That is why a category can't contain "_",
  which separates the parts of a folder name.
