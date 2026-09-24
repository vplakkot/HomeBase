-- Storage (REQ-87): everything in the basement, boxed or not, each with
-- an ID that goes on the box's label. And archiving a paperwork file into
-- one of those boxes (REQ-98).
--
-- Like a paperwork file's number, an entry's number is handed out by the
-- database, one after another, and never changes or comes back.

create table public.storage_entries (
  id uuid primary key default gen_random_uuid(),
  -- Shown as S-001. "generated always" refuses any number but the next
  -- one, and refuses changing it afterwards.
  number bigint generated always as identity unique,
  name text not null check (btrim(name) <> ''),
  is_box boolean not null default false,
  -- One item per line. Only a box has contents; loose items are just
  -- their name.
  contents text check (is_box or contents is null),
  note text,
  created_at timestamptz not null default now()
);

alter table public.storage_entries enable row level security;
revoke all on public.storage_entries from anon;

-- Any member sees, adds, changes and removes entries; nothing entered by
-- mistake is ever stuck.
create policy "members read storage"
  on public.storage_entries for select to authenticated
  using ((select public.is_member()));

create policy "members add storage"
  on public.storage_entries for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change storage"
  on public.storage_entries for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members remove storage"
  on public.storage_entries for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- REQ-98: an archived file is in a box. Archived and "in a box" are the
-- same fact, so the database keeps them together. A box holding files
-- can't be removed ("on delete restrict"): the files move first.
alter table public.paperwork_files
  add column storage_entry_id uuid references public.storage_entries (id) on delete restrict,
  add constraint paperwork_files_archived_in_a_box
    check ((status = 'archived') = (storage_entry_id is not null));

create index paperwork_files_storage_entry on public.paperwork_files (storage_entry_id);

-- Only a box takes files, and a box holding files stays a box. Each rule
-- sits on the table whose write would break it.
create function public.refuse_file_outside_a_box()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.storage_entry_id is not null and not exists (
    select 1 from public.storage_entries where id = new.storage_entry_id and is_box
  ) then
    raise exception 'A file can only be archived into a box';
  end if;
  return new;
end;
$$;

create trigger refuse_file_outside_a_box
  before insert or update of storage_entry_id on public.paperwork_files
  for each row execute function public.refuse_file_outside_a_box();

create function public.refuse_unboxing_with_files()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_box and not new.is_box and exists (
    select 1 from public.paperwork_files where storage_entry_id = new.id
  ) then
    raise exception 'This box holds archived files; move them first';
  end if;
  return new;
end;
$$;

create trigger refuse_unboxing_with_files
  before update of is_box on public.storage_entries
  for each row execute function public.refuse_unboxing_with_files();
