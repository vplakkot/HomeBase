# Lesson 36: Changing a table under a running app

REQ-179 turned a file's location from typed text into a record of its
own. The catch: the database changes **before** the new code is live.
Two people could be using the old app in between, and the old app still
writes the old column.

## Think of moving a shop's shelves while it is open

You can't empty a shelf and rearrange it mid-trade. You put the new
shelves up beside the old, keep both stocked, move customers across,
and only later take the old shelf away. Databases call this **expand,
then contract**.

1. **Expand** (this pull request's migration): add `paperwork_locations`
   and `paperwork_files.location_id`; copy the old text across; leave the
   old `location` column in place, just no longer required.
2. **Keep both true.** A trigger turns text written by the old app into
   a location (finding the matching one or making it), and always writes
   the location's name back into the old column. A second trigger
   carries a rename to the old column too. So whichever app writes, the
   other still reads something correct.
3. **Contract** (a later migration, once the new code has been live): drop
   the `location` column and the triggers. It is owed and must not ship in
   the same release.

## The rules that did the heavy lifting

- **Sameness is decided by the database.** The unique index compares
  names ignoring case and extra spaces, so no screen can sneak in a
  duplicate, and "location with files can't be deleted" is a foreign key
  (`on delete restrict`), not just a hidden button.
- **A thing that isn't a file shouldn't pretend to be one.** The archive
  for a storage box (REQ-153) would have needed a file number and a
  category, and numbers must never be used up by anything but real
  labelled files. So it is its own small table, and a document is in a
  file *or* an archive, never both (a `check`).
- **Prove SQL on a real database.** The migration was run on an in-memory
  Postgres (PGlite) against rows shaped like production: backfill,
  duplicate refusal, the old app's writes, rename, delete, and the box
  and archive rules. What that did not prove: the row-level security rules
  and how Supabase applies the migration.

## When an empty column can mean "the old rule" (REQ-196)

A 2-meal dish used to cover its meal and the very next one. Giving it a
second meal of its own meant two new columns, and the easy plan was to
fill them in for every existing dish. We mostly didn't. An empty second
meal simply *means* "the meal after the first", in the app and in the
database check for two dishes on one meal. So almost every dish keeps the
meals it shows, and the old app (which never writes the new columns)
stays correct for them. Only a dish someone moves gets a second meal
written.

The exception shows the cost of converting anything. One guarded update
moved lunch-start dishes that were clearly wrong (lunch and dinner the
same day). In the short gap between the database change and the new code
going live, the old app still shows those on the same day's dinner, and
anything it saves puts them back. When a missing value can carry the old
meaning, prefer that to a backfill, and when you do convert, say what the
gap looks like.

## Renaming a table, and finishing the owed contract (REQ-205, REQ-206)

Calling every "file" a "File Folder" meant renaming the table
`paperwork_files` and the column `paperwork.file_id`. A rename is the
cheapest expand-and-contract there is, with one trap and one cost.

- **Think of changing the sign on a shop door.** The shop, the stock and
  the till are untouched; only the label changes. `alter table ... rename`
  keeps every row, number, link and security rule, because Postgres tracks
  those by identity, not by name. Even the F-numbers carry on, since the
  counter belongs to the table.
- **The trap: code written as text doesn't follow.** A database function's
  body is stored as plain text, so the function that said
  `paperwork_files` (the one stopping a box with File Folders from being
  un-boxed) kept saying it and would have failed the first time someone
  used it. The migration writes it again, along with two others whose
  error messages used the old word. (A
  table's own constraints and policies are not text, so they came along.)
- **The cost: a short gap.** The migration reaches the database before the
  new code is live, and in between the old app asks for a table and a
  column that no longer have those names. For a household of two this is a
  couple of minutes, not worth a compatibility layer that would itself need
  removing later; it is stated rather than hidden.
- **Finishing the contract.** The `location` text column and its two
  triggers, owed since REQ-179, went in the same migration: the app has
  only used `location_id` for two releases. It had to, because "Not
  placed" means no location at all, which those triggers would have
  quietly undone by turning an empty place back into the old text.
- **Where empty means something.** A File Folder with no location is
  "Not placed", but only an active physical one: a Google Drive folder must
  still be in Drive, and an archived one reads as its box. Those rules
  stayed in the database (the existing Drive trigger already treated "no
  location" as "not Drive"), so no screen has to remember them.
- **Prove it on a real database.** The migration was run on an in-memory
  Postgres (PGlite) after the earlier Paperwork migrations, on rows shaped
  like production: the rows, links and numbers survive, a File Folder can be
  made without a location, a Drive one without a location is refused, an
  unplaced one can be archived, and the box rules still hold. What that did
  not prove: how Supabase applies the file.
