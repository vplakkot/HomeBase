-- Paperwork (REQ-88, REQ-97): the household's physical files, the
-- categories they're sorted into, and the paperwork inside them.
--
-- A file's number is handed out by the database, one after another, and
-- never changes or comes back: it's printed on the file's label, so it has
-- to outlive a change of category, a move, or the file being removed.
-- Paperwork has no location of its own; it's either in a file or
-- Unfiled (no file), and Unfiled is what Home asks someone to deal with.

-- The admin decides the categories (REQ-88); nothing is hardcoded.
insert into public.role_permissions (role_id, permission)
select id, 'manage_paperwork' from public.roles where name = 'Admin';

create table public.paperwork_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- Paperwork filed under this category is kept this many years by default.
  keep_years integer check (keep_years between 1 and 100),
  created_at timestamptz not null default now()
);

-- "Taxes" and "taxes" would be the same category to anyone reading a label.
create unique index paperwork_categories_name on public.paperwork_categories (lower(btrim(name)));

create table public.paperwork_files (
  id uuid primary key default gen_random_uuid(),
  -- Shown as F-0001. "generated always" refuses any number but the next
  -- one, and refuses changing it afterwards; a number used once is never
  -- handed out again, even if its file is removed.
  number bigint generated always as identity unique,
  -- A category in use can't be removed: its files are recategorized first.
  category_id uuid not null references public.paperwork_categories (id) on delete restrict,
  location text not null check (btrim(location) <> ''),
  label text check (label is null or btrim(label) <> ''),
  -- Archiving to a storage box comes with REQ-98; until then every file
  -- is active.
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create table public.paperwork (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- A household member, or null for Joint.
  owner_id uuid references public.household_members (user_id) on delete set null,
  -- The date the paperwork is about, so keep-until works for old papers.
  document_date date,
  notes text,
  keep_until date,
  -- Null is Unfiled. Removing a file puts its paperwork back to Unfiled
  -- rather than losing it.
  file_id uuid references public.paperwork_files (id) on delete set null,
  logged_on date not null default (now() at time zone 'America/New_York')::date,
  created_at timestamptz not null default now()
);

create index paperwork_file on public.paperwork (file_id);

alter table public.paperwork_categories enable row level security;
alter table public.paperwork_files enable row level security;
alter table public.paperwork enable row level security;
revoke all on public.paperwork_categories, public.paperwork_files, public.paperwork from anon;

-- Everyone in the household sees every category, file and paper (REQ-88).
create policy "members read paperwork categories"
  on public.paperwork_categories for select to authenticated
  using ((select public.is_member()));

create policy "members read paperwork files"
  on public.paperwork_files for select to authenticated
  using ((select public.is_member()));

create policy "members read paperwork"
  on public.paperwork for select to authenticated
  using ((select public.is_member()));

-- Only the admin changes categories.
create policy "admins add paperwork categories"
  on public.paperwork_categories for insert to authenticated
  with check ((select public.has_permission('manage_paperwork')));

create policy "admins change paperwork categories"
  on public.paperwork_categories for update to authenticated
  using ((select public.has_permission('manage_paperwork')))
  with check ((select public.has_permission('manage_paperwork')));

create policy "admins remove paperwork categories"
  on public.paperwork_categories for delete to authenticated
  using ((select public.has_permission('manage_paperwork')));

-- Any member makes, moves, edits and removes files and paperwork; nothing
-- entered by mistake is ever stuck.
create policy "members add paperwork files"
  on public.paperwork_files for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change paperwork files"
  on public.paperwork_files for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members remove paperwork files"
  on public.paperwork_files for delete to authenticated
  using ((select public.has_permission('use_modules')));

create policy "members log paperwork"
  on public.paperwork for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change paperwork"
  on public.paperwork for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members remove paperwork"
  on public.paperwork for delete to authenticated
  using ((select public.has_permission('use_modules')));
