-- Paperwork: the Google Drive location (REQ-152), with the Drive halves
-- of single-document archiving (REQ-153) and the built-in location
-- (REQ-179).
--
-- A Drive File is a File whose paperwork lives in one Google Drive folder.
-- The documents themselves stay in Drive: HomeBase only keeps a copy of
-- what it last saw there (names, who owns each, whether it's still there)
-- so pages open fast, and the few facts Drive can't hold (which household
-- member a document belongs to). Everything here only ADDS, so the
-- running app keeps working until the new code is live.

-- The member's Google account, so a document Drive says they own is
-- theirs in HomeBase too. Optional; the admin sets it.
alter table public.household_members
  add column google_email text check (google_email is null or btrim(google_email) <> '');

-- Which Google account each member's documents are under: the one an
-- admin saved, else the email they sign in with (often the same). Members
-- can't read each other's sign-in emails, so this hands back only the
-- address used for matching, for members of the household.
create function public.paperwork_member_accounts()
returns table (user_id uuid, google_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select hm.user_id, coalesce(hm.google_email, u.email::text)
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  where (select public.is_member());
$$;

revoke all on function public.paperwork_member_accounts() from public, anon;
grant execute on function public.paperwork_member_accounts() to authenticated;

-- Google Drive is a place files are kept, built in: it can't be renamed
-- or removed, and no physical file can be put there.
alter table public.paperwork_locations
  add column built_in text unique check (built_in = 'drive');

-- A household that already made a place called "Google Drive" by hand
-- keeps it, renamed so the built-in one can take the name.
update public.paperwork_locations
set name = name || ' (office)'
where built_in is null
  and lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = 'google drive';

insert into public.paperwork_locations (name, built_in) values ('Google Drive', 'drive');

create function public.keep_built_in_locations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.built_in is not null then
    if tg_op = 'DELETE' then
      raise exception 'The Google Drive location is built in and can''t be removed';
    end if;
    if new.name is distinct from old.name or new.built_in is distinct from old.built_in then
      raise exception 'The Google Drive location is built in and can''t be changed';
    end if;
  elsif tg_op = 'UPDATE' and new.built_in is not null then
    raise exception 'A location can''t be made built in';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger keep_built_in_locations
  before update or delete on public.paperwork_locations
  for each row execute function public.keep_built_in_locations();

-- A Drive File: its location type is set when it's made and never
-- changes. It is linked to its folder by the folder's Drive ID, never by
-- name (null while it waits for the folder to be made). A Drive File is
-- archived by moving its folder into Drive's Archived folder, so it's
-- archived without a storage box.
alter table public.paperwork_files
  add column is_drive boolean not null default false,
  add column drive_folder_id text unique,
  add constraint paperwork_files_drive_folder_is_drive check (drive_folder_id is null or is_drive);

alter table public.paperwork_files drop constraint paperwork_files_archived_in_a_box;
alter table public.paperwork_files
  add constraint paperwork_files_archived_in_a_box check (
    case
      when is_drive then storage_entry_id is null
      else (status = 'archived') = (storage_entry_id is not null)
    end
  );

-- Drive Files sit in the Drive location and physical ones never do. Named
-- to run after the trigger that fills in a location from old-style text.
create function public.keep_drive_files_in_drive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  in_drive boolean;
begin
  if tg_op = 'UPDATE' and new.is_drive is distinct from old.is_drive then
    raise exception 'A file can''t move between Google Drive and a physical location';
  end if;
  select built_in is not null into in_drive from public.paperwork_locations where id = new.location_id;
  if new.is_drive is distinct from coalesce(in_drive, false) then
    raise exception 'Google Drive files are kept in Google Drive, and physical files are not';
  end if;
  return new;
end;
$$;

create trigger zz_keep_drive_files_in_drive
  before insert or update of is_drive, location_id on public.paperwork_files
  for each row execute function public.keep_drive_files_in_drive();

-- The one connected folder (REQ-152: one folder, one household). `id`
-- only ever holds true, so there can be one row. `archived_folder_id` is
-- the `Archived` sub-folder found when the folder was connected.
create table public.paperwork_drive (
  id boolean primary key default true check (id),
  folder_id text not null,
  archived_folder_id text not null,
  synced_at timestamptz
);

-- What the last sync saw of the sub-folders (one per File, plus any
-- nobody has linked yet) and of the documents directly inside them.
create table public.paperwork_drive_folders (
  drive_id text primary key,
  name text not null,
  -- Inside the `Archived` folder.
  in_archived boolean not null default false,
  -- The admin chose to ignore it ("Unlinked folder").
  ignored boolean not null default false,
  -- Deleted or trashed in Drive since.
  missing boolean not null default false
);

create table public.paperwork_drive_documents (
  drive_id text primary key,
  name text not null,
  mime_type text,
  -- Opens the document in Google Drive.
  link text,
  -- Who Drive says owns it.
  drive_owner_email text,
  -- The folder it's directly in: a File's, `Archived`, or the top one.
  parent_id text not null,
  -- A household member, or null for Joint; only meaningful once
  -- `owner_set` (until then it shows "Owner not set" in a File).
  owner_id uuid references public.household_members (user_id) on delete set null,
  owner_set boolean not null default false,
  missing boolean not null default false
);

create index paperwork_drive_documents_parent on public.paperwork_drive_documents (parent_id);

alter table public.paperwork_drive enable row level security;
alter table public.paperwork_drive_folders enable row level security;
alter table public.paperwork_drive_documents enable row level security;
revoke all on public.paperwork_drive, public.paperwork_drive_folders, public.paperwork_drive_documents from anon;

create policy "members read paperwork drive"
  on public.paperwork_drive for select to authenticated
  using ((select public.is_member()));

create policy "admins connect paperwork drive"
  on public.paperwork_drive for insert to authenticated
  with check ((select public.has_permission('manage_paperwork')));

create policy "admins change paperwork drive"
  on public.paperwork_drive for update to authenticated
  using ((select public.has_permission('manage_paperwork')))
  with check ((select public.has_permission('manage_paperwork')));

create policy "admins disconnect paperwork drive"
  on public.paperwork_drive for delete to authenticated
  using ((select public.has_permission('manage_paperwork')));

create policy "members read paperwork drive folders"
  on public.paperwork_drive_folders for select to authenticated
  using ((select public.is_member()));

create policy "members add paperwork drive folders"
  on public.paperwork_drive_folders for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change paperwork drive folders"
  on public.paperwork_drive_folders for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members remove paperwork drive folders"
  on public.paperwork_drive_folders for delete to authenticated
  using ((select public.has_permission('use_modules')));

create policy "members read paperwork drive documents"
  on public.paperwork_drive_documents for select to authenticated
  using ((select public.is_member()));

create policy "members add paperwork drive documents"
  on public.paperwork_drive_documents for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change paperwork drive documents"
  on public.paperwork_drive_documents for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

-- Only the admin removes the record of a document Drive no longer has.
create policy "admins remove paperwork drive documents"
  on public.paperwork_drive_documents for delete to authenticated
  using ((select public.has_permission('manage_paperwork')));

-- Any member's sync stamps the time; members can't edit the connection
-- itself, so this is the one thing they may change on it.
create function public.record_drive_sync()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.paperwork_drive set synced_at = now() where (select public.is_member());
$$;

revoke execute on function public.record_drive_sync() from public, anon;
grant execute on function public.record_drive_sync() to authenticated;
