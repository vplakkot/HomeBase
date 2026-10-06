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
