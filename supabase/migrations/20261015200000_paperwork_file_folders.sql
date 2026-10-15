-- Paperwork: "File Folders" (REQ-205) that can be Not placed (REQ-206).
--
-- REQ-205 renames the container layer end to end, so the words in the app,
-- the code and the database stay the same: `paperwork_files` becomes
-- `paperwork_file_folders`, and a paper's `file_id` becomes
-- `file_folder_id`. Nothing is copied or renumbered: a rename keeps every
-- row, F-number, link and policy as they were.
--
-- REQ-206 lets a physical File Folder be made before anyone knows where it
-- will live: `location_id` may now be empty, and empty means "Not placed".
--
-- This also finishes the job REQ-179 left owed: the old free-text
-- `location` column and the two triggers that kept it in step with
-- `location_id`. The app has only used `location_id` since it went live,
-- and a Not placed folder (no location at all) is exactly what those
-- triggers would have fought.
--
-- Functions keep their bodies as text, so a table rename does not follow
-- them: the one that names the table is written again below (two more are
-- written again only to change the word in what they refuse).

alter table public.paperwork_files rename to paperwork_file_folders;
alter table public.paperwork rename column file_id to file_folder_id;

-- Names that carried the old word.
alter index public.paperwork_file rename to paperwork_file_folder;
alter index public.paperwork_files_storage_entry rename to paperwork_file_folders_storage_entry;
alter index public.paperwork_files_location rename to paperwork_file_folders_location;
alter table public.paperwork_file_folders rename constraint paperwork_files_archived_in_a_box to paperwork_file_folders_archived_in_a_box;
alter table public.paperwork_file_folders rename constraint paperwork_files_drive_folder_is_drive to paperwork_file_folders_drive_folder_is_drive;
alter table public.paperwork rename constraint paperwork_in_a_file_or_an_archive to paperwork_in_a_file_folder_or_an_archive;
alter sequence public.paperwork_files_number_seq rename to paperwork_file_folders_number_seq;

-- REQ-206: no location yet. Archived folders keep whatever they had, and a
-- Google Drive folder still has to be in Google Drive (that trigger reads
-- an empty location as "not Drive", so a Drive one is refused).
alter table public.paperwork_file_folders alter column location_id drop not null;

-- The old text column and its two triggers go (see the top).
drop trigger sync_paperwork_file_location on public.paperwork_file_folders;
drop trigger sync_renamed_location on public.paperwork_locations;
drop function public.sync_paperwork_file_location();
drop function public.sync_renamed_location();
alter table public.paperwork_file_folders drop column location;

create or replace function public.refuse_unboxing_with_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_box and not new.is_box then
    if exists (select 1 from public.paperwork_file_folders where storage_entry_id = new.id)
      or exists (
        select 1 from public.paperwork
        where archive_id in (select id from public.paperwork_archives where storage_entry_id = new.id)
      ) then
      raise exception 'This box holds archived File Folders or documents; move them first';
    end if;
    delete from public.paperwork_archives where storage_entry_id = new.id;
  end if;
  return new;
end;
$$;

-- The other two functions that say "file" in what they refuse.
alter function public.refuse_file_outside_a_box() rename to refuse_file_folder_outside_a_box;
alter trigger refuse_file_outside_a_box on public.paperwork_file_folders rename to refuse_file_folder_outside_a_box;

create or replace function public.refuse_file_folder_outside_a_box()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.storage_entry_id is not null and not exists (
    select 1 from public.storage_entries where id = new.storage_entry_id and is_box
  ) then
    raise exception 'A File Folder can only be archived into a box';
  end if;
  return new;
end;
$$;

create or replace function public.keep_drive_files_in_drive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  in_drive boolean;
begin
  if tg_op = 'UPDATE' and new.is_drive is distinct from old.is_drive then
    raise exception 'A File Folder can''t move between Google Drive and a physical location';
  end if;
  select built_in is not null into in_drive from public.paperwork_locations where id = new.location_id;
  if new.is_drive is distinct from coalesce(in_drive, false) then
    raise exception 'Google Drive File Folders are kept in Google Drive, and physical ones are not';
  end if;
  return new;
end;
$$;
