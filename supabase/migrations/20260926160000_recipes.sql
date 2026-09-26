-- Meal Plan's recipe cards (REQ-110), added by typing (REQ-111) or read
-- from an uploaded video (REQ-112, BETA).
--
-- A recipe keeps its ingredients as a list of { quantity, unit, item,
-- note } so a later batch can scale them (REQ-113). Only the name is
-- required: a half-finished card can still be saved and fixed later.

-- REQ-110: cuisines come from a list the app keeps. A recipe that needs a
-- new one adds it the first time; the list starts with the common ones.
create table public.cuisines (
  name text primary key check (btrim(name) <> '' and char_length(name) <= 40)
);

insert into public.cuisines (name) values
  ('American'), ('Chinese'), ('French'), ('Greek'), ('Indian'), ('Italian'),
  ('Japanese'), ('Korean'), ('Lebanese'), ('Mediterranean'), ('Mexican'),
  ('Spanish'), ('Thai'), ('Turkish'), ('Vietnamese');

alter table public.cuisines enable row level security;
revoke all on public.cuisines from anon;

create policy "members read cuisines"
  on public.cuisines for select to authenticated
  using ((select public.is_member()));

create policy "members add cuisines"
  on public.cuisines for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- A path in the recipe-photos bucket: a still from the video, or our own.
  photo text,
  video_url text,
  page_url text,
  cuisine text references public.cuisines (name) on update cascade,
  main_meat text,
  -- REQ-110: one of four; a dish that works in oven and air fryer is Air fryer.
  cooking_method text check (cooking_method in ('Stove top', 'Air fryer', 'Instant Pot', 'Oven')),
  cook_minutes integer check (cook_minutes > 0),
  servings integer check (servings > 0),
  ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array'),
  steps text[] not null default '{}',
  notes text,
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.recipes enable row level security;
revoke all on public.recipes from anon;

-- Either of us sees, adds, changes and removes any recipe (REQ-111).
create policy "members read recipes"
  on public.recipes for select to authenticated
  using ((select public.is_member()));

create policy "members add recipes"
  on public.recipes for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change recipes"
  on public.recipes for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members remove recipes"
  on public.recipes for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- A recipe on its way in: typed text or a video Gemini is reading. The
-- video goes from the phone straight to Google; this row follows it from
-- uploading to processing to ready (a draft to review) or failed. Only
-- the person who started it sees it, so the "Recipe ready" toast reaches
-- them and no one else. Saving the draft makes a recipe and removes it.
create table public.recipe_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.household_members (user_id) on delete cascade default auth.uid(),
  name text not null check (btrim(name) <> ''),
  video_url text,
  -- The one-time link the phone sends the video to. Google won't let a
  -- browser read its answer once a video sent in pieces is complete
  -- (seen 2026-09-26), so the server asks it instead, with this link.
  upload_url text,
  -- Google's name for the uploaded video ("files/abc123"), while it exists.
  gemini_file text,
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'ready', 'failed')),
  draft jsonb,
  error text,
  photo text,
  -- The toast has been seen (or dismissed).
  seen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recipe_imports enable row level security;
revoke all on public.recipe_imports from anon;

create policy "members read their own imports"
  on public.recipe_imports for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

create policy "members start their own imports"
  on public.recipe_imports for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_permission('use_modules')));

create policy "members change their own imports"
  on public.recipe_imports for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()))
  with check (user_id = (select auth.uid()) and (select public.has_permission('use_modules')));

create policy "members remove their own imports"
  on public.recipe_imports for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

create index recipe_imports_user on public.recipe_imports (user_id);

-- Recipe photos, private like the drink labels: members only, through
-- short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', false, 1048576, array['image/jpeg']);

create policy "members read recipe photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'recipe-photos' and (select public.is_member()));

create policy "members add recipe photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and (select public.has_permission('use_modules')));

create policy "members replace recipe photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'recipe-photos' and (select public.has_permission('use_modules')))
  with check (bucket_id = 'recipe-photos' and (select public.has_permission('use_modules')));

create policy "members remove recipe photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and (select public.has_permission('use_modules')));
