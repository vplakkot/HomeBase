-- Paperwork: managed locations (REQ-179) and archives for single
-- documents (REQ-153).
--
-- Until now a file's location was free text. From here a location is a
-- record of its own and a file points at it, so a place can be set up
-- before any file uses it, renamed in one go, and removed once empty.
--
-- And a single document can go straight to a storage box without a file:
-- each box gets one "archive" (made the first time a document is archived
-- into it), and a document is either in a file, in an archive, or Unfiled.
-- An archive is not a file: it has no F-ID (so it never uses up a
-- number), no category and no label.
--
-- This migration only ADDS (and relaxes `location` to allow empty). The old
-- `location` text column stays until a later migration, once the new code
-- is live: a migration reaches Supabase before the code reaches main, so
-- dropping it here would break the running app in between. Until then the
-- old app can still write it, and a trigger turns that text into a
-- location record, so no file is ever left without one.

create table public.paperwork_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

-- "Hall cupboard" and "hall  cupboard" are the same place.
create unique index paperwork_locations_name
  on public.paperwork_locations (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

-- One location per distinct text already on a file, spelt the way the
-- file made first spells it.
insert into public.paperwork_locations (name)
select spelled
from (
  select distinct on (key) spelled
  from (
    select
      btrim(regexp_replace(location, '\s+', ' ', 'g')) as spelled,
      lower(btrim(regexp_replace(location, '\s+', ' ', 'g'))) as key,
      created_at,
      number
    from public.paperwork_files
  ) as files
  order by key, created_at, number
) as firsts;

alter table public.paperwork_files
  add column location_id uuid references public.paperwork_locations (id) on delete restrict,
  alter column location drop not null;

update public.paperwork_files as file
set location_id = place.id
from public.paperwork_locations as place
where lower(regexp_replace(btrim(place.name), '\s+', ' ', 'g'))
    = lower(btrim(regexp_replace(file.location, '\s+', ' ', 'g')));

alter table public.paperwork_files alter column location_id set not null;

create index paperwork_files_location on public.paperwork_files (location_id);

-- Keeps the two ways of saying where a file is in step, so the old app
-- and the new one can both write files until the old column goes: text
-- with no location gets (or makes) the location of that name, and the
-- text always reads as the location's current name.
create function public.sync_paperwork_file_location()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  spelled text;
  found uuid;
begin
  if new.location_id is null
    or (tg_op = 'UPDATE'
      and new.location is distinct from old.location
      and new.location_id is not distinct from old.location_id) then
    spelled := btrim(regexp_replace(new.location, '\s+', ' ', 'g'));
    select id into found from public.paperwork_locations
      where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = lower(spelled);
    if found is null then
      insert into public.paperwork_locations (name) values (spelled) returning id into found;
    end if;
    new.location_id := found;
  end if;
  select name into new.location from public.paperwork_locations where id = new.location_id;
  return new;
end;
$$;

create trigger sync_paperwork_file_location
  before insert or update of location, location_id on public.paperwork_files
  for each row execute function public.sync_paperwork_file_location();

-- A renamed location reads the same on the old column.
create function public.sync_renamed_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.paperwork_files set location = new.name where location_id = new.id;
  return new;
end;
$$;

create trigger sync_renamed_location
  after update of name on public.paperwork_locations
  for each row execute function public.sync_renamed_location();

alter table public.paperwork_locations enable row level security;
revoke all on public.paperwork_locations from anon;

-- Any member sees and manages locations, matching "all members see all
-- files" (REQ-179). A location with files can't be removed (the file's
-- reference is "on delete restrict").
create policy "members read paperwork locations"
  on public.paperwork_locations for select to authenticated
  using ((select public.is_member()));

create policy "members add paperwork locations"
  on public.paperwork_locations for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change paperwork locations"
  on public.paperwork_locations for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members remove paperwork locations"
  on public.paperwork_locations for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- REQ-153: a box's archive. One per box, made when the first document
-- goes in. It goes when its box goes; a box whose archive still holds
-- documents can't be removed ("on delete restrict" on the documents).
create table public.paperwork_archives (
  id uuid primary key default gen_random_uuid(),
  storage_entry_id uuid not null unique references public.storage_entries (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.paperwork
  add column archive_id uuid references public.paperwork_archives (id) on delete restrict,
  add constraint paperwork_in_a_file_or_an_archive check (file_id is null or archive_id is null);

create index paperwork_archive on public.paperwork (archive_id);

-- Only a box has an archive, as only a box takes archived files.
create function public.refuse_archive_outside_a_box()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.storage_entries where id = new.storage_entry_id and is_box) then
    raise exception 'An archive can only be in a box';
  end if;
  return new;
end;
$$;

create trigger refuse_archive_outside_a_box
  before insert or update of storage_entry_id on public.paperwork_archives
  for each row execute function public.refuse_archive_outside_a_box();

-- A box holding archived files or archived documents stays a box. Its
-- archive, once empty, goes with it (security definer: members can't
-- delete an archive themselves).
create or replace function public.refuse_unboxing_with_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_box and not new.is_box then
    if exists (select 1 from public.paperwork_files where storage_entry_id = new.id)
      or exists (
        select 1 from public.paperwork
        where archive_id in (select id from public.paperwork_archives where storage_entry_id = new.id)
      ) then
      raise exception 'This box holds archived files or documents; move them first';
    end if;
    delete from public.paperwork_archives where storage_entry_id = new.id;
  end if;
  return new;
end;
$$;

alter table public.paperwork_archives enable row level security;
revoke all on public.paperwork_archives from anon;

-- Members see archives and make them; nobody changes or removes one
-- (REQ-153: an archive can't be renamed, deleted or moved).
create policy "members read paperwork archives"
  on public.paperwork_archives for select to authenticated
  using ((select public.is_member()));

create policy "members add paperwork archives"
  on public.paperwork_archives for insert to authenticated
  with check ((select public.has_permission('use_modules')));
