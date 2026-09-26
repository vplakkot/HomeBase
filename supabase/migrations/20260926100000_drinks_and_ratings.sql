-- Drinks (REQ-37, REQ-30, REQ-29): every wine we've had, and each
-- person's star rating of it.
--
-- A drink holds what a label can tell us (REQ-27 lists the fields); only
-- the name is required, so something typed from a menu is still a drink.
-- Type, grapes, region and country are free text: the app offers the
-- standard lists (lib/drinks/lists.ts) and files synonyms like Syrah and
-- Shiraz together, but keeps what was written.

create table public.drinks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  producer text,
  type text check (type in ('red', 'white', 'rosé', 'sparkling', 'dessert', 'fortified', 'orange')),
  -- A year, or non_vintage ("NV"); never both.
  vintage integer check (vintage between 1800 and 2200),
  non_vintage boolean not null default false,
  grapes text[] not null default '{}',
  region text,
  country text,
  abv numeric(4, 1) check (abv > 0 and abv <= 100),
  bottle_ml integer check (bottle_ml > 0),
  -- Sparkling wines only, when the label says (REQ-27).
  sweetness text,
  method text,
  disgorged_on date,
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint drinks_vintage_or_nv check (not (non_vintage and vintage is not null))
);

alter table public.drinks enable row level security;
revoke all on public.drinks from anon;

-- Any member sees, adds, changes and removes drinks; nothing entered by
-- mistake is ever stuck.
create policy "members read drinks"
  on public.drinks for select to authenticated
  using ((select public.is_member()));

create policy "members add drinks"
  on public.drinks for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change drinks"
  on public.drinks for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members remove drinks"
  on public.drinks for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- REQ-29: one rating per person per drink (the primary key), whole stars
-- 1 to 5 and an optional one-line comment. Rating again replaces it; no
-- history is kept. Removing the drink removes its ratings.
create table public.drink_ratings (
  drink_id uuid not null references public.drinks (id) on delete cascade,
  user_id uuid not null references public.household_members (user_id) on delete cascade default auth.uid(),
  stars smallint not null check (stars between 1 and 5),
  comment text check (comment !~ '[\r\n]' and char_length(comment) <= 200),
  updated_at timestamptz not null default now(),
  primary key (drink_id, user_id)
);

alter table public.drink_ratings enable row level security;
revoke all on public.drink_ratings from anon;

-- Everyone sees every rating, by name (REQ-29). Each person writes only
-- their own: the rows' user_id must be the signed-in person, so even a
-- hand-made request can't rate for someone else.
create policy "members read ratings"
  on public.drink_ratings for select to authenticated
  using ((select public.is_member()));

create policy "members rate for themselves"
  on public.drink_ratings for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_permission('use_modules')));

create policy "members change their own rating"
  on public.drink_ratings for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()))
  with check (user_id = (select auth.uid()) and (select public.has_permission('use_modules')));

-- A rating given by mistake can be taken back, by the person who gave it.
create policy "members remove their own rating"
  on public.drink_ratings for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

-- "Last changed" is the database's clock, not whatever the app sends.
create function public.stamp_rating_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stamp_rating_change
  before insert or update on public.drink_ratings
  for each row execute function public.stamp_rating_change();

create index drink_ratings_user on public.drink_ratings (user_id);
