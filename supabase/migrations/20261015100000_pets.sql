-- Pets (REQ-186 to REQ-189): a profile for each pet, its vaccines, its
-- diet and the medications and preventives given at home.
--
-- Like every table of records here, anything a member entered can be
-- removed by any member: nothing entered by mistake is ever stuck.

-- REQ-186: a pet. Archiving hides it from the module home and keeps all
-- of its records.
create table public.pets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  nickname text,
  species text not null check (btrim(species) <> ''),
  -- Path in the private pet-photos bucket; the small copy for the home
  -- card sits beside it with "-thumb" before ".jpg".
  photo_path text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- REQ-187: one row per dose of a vaccine. The latest row per vaccine name
-- is the current one; earlier rows stay as history. The next due date is
-- typed by hand, never worked out.
create table public.pet_vaccines (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  given_on date not null,
  next_due_on date not null check (next_due_on >= given_on),
  clinic text,
  notes text,
  created_at timestamptz not null default now()
);
create index pet_vaccines_pet on public.pet_vaccines (pet_id);

-- REQ-188: one row per stretch on one diet. The current diet has no end
-- date; changing what or how much ends it and starts another.
create table public.pet_diets (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  kind text not null check (kind in ('commercial', 'prescription', 'home_cooked')),
  -- Commercial and prescription foods.
  brand text,
  product text,
  purpose text,
  -- Home-cooked food.
  protein text,
  batch_prep_on date,
  grams_per_meal numeric(7, 1) not null check (grams_per_meal > 0),
  meals_per_day integer not null check (meals_per_day > 0),
  notes text,
  started_on date not null,
  ended_on date check (ended_on is null or ended_on >= started_on),
  created_at timestamptz not null default now(),
  constraint pet_diets_kind_fields check (
    (kind = 'home_cooked' and protein is not null)
    or (kind <> 'home_cooked' and brand is not null and product is not null)
  )
);
create index pet_diets_pet on public.pet_diets (pet_id);
-- A pet has one current diet.
create unique index pet_diets_one_current on public.pet_diets (pet_id) where ended_on is null;

-- REQ-189: a medication or preventive, which one product several pets
-- may take. Its supply is optional and is about the product, not a pet.
create table public.pet_medications (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  purpose text,
  dose text,
  frequency text not null check (frequency in ('daily', 'monthly', 'every_n_days')),
  every_n_days integer check (every_n_days is null or every_n_days > 0),
  starts_on date not null,
  -- Empty means ongoing.
  ends_on date check (ends_on is null or ends_on >= starts_on),
  prescribing_vet text,
  doses_on_hand integer check (doses_on_hand is null or doses_on_hand >= 0),
  doses_per_delivery integer check (doses_per_delivery is null or doses_per_delivery > 0),
  delivery_interval_months integer check (delivery_interval_months is null or delivery_interval_months > 0),
  last_delivery_on date,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  created_at timestamptz not null default now(),
  constraint pet_medications_interval check ((frequency = 'every_n_days') = (every_n_days is not null))
);

-- Which pets take a medication, and when each one is next due.
create table public.pet_medication_pets (
  medication_id uuid not null references public.pet_medications (id) on delete cascade,
  pet_id uuid not null references public.pets (id) on delete cascade,
  -- Empty once the course has ended.
  next_dose_on date,
  primary key (medication_id, pet_id)
);
create index pet_medication_pets_pet on public.pet_medication_pets (pet_id);

-- Each "Mark given". It remembers the next-dose date it moved on from, so
-- the latest one can be undone.
create table public.pet_doses (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.pet_medications (id) on delete cascade,
  pet_id uuid not null references public.pets (id) on delete cascade,
  given_on date not null,
  given_by uuid references auth.users (id) on delete set null default auth.uid(),
  previous_next_dose_on date,
  created_at timestamptz not null default now()
);
create index pet_doses_medication on public.pet_doses (medication_id, pet_id);

-- Any member sees, adds, changes and removes all of it.
do $$
declare
  t text;
begin
  foreach t in array array['pets', 'pet_vaccines', 'pet_diets', 'pet_medications', 'pet_medication_pets', 'pet_doses']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_member()))',
      'members read ' || t, t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.has_permission(%L)))',
      'members add ' || t, t, 'use_modules');
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.has_permission(%L))) with check ((select public.has_permission(%L)))',
      'members change ' || t, t, 'use_modules', 'use_modules');
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.has_permission(%L)))',
      'members remove ' || t, t, 'use_modules');
  end loop;
end;
$$;

-- Pet photos: a private bucket, like the drinks' label photos. Nothing in
-- it has a public address; the app hands members short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-photos', 'pet-photos', false, 1048576, array['image/jpeg']);

create policy "members read pet photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'pet-photos' and (select public.is_member()));

create policy "members add pet photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-photos' and (select public.has_permission('use_modules')));

create policy "members replace pet photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'pet-photos' and (select public.has_permission('use_modules')))
  with check (bucket_id = 'pet-photos' and (select public.has_permission('use_modules')));

create policy "members remove pet photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'pet-photos' and (select public.has_permission('use_modules')));
