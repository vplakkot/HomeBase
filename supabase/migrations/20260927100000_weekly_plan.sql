-- Meal Plan batch 2: hiding recipes from the library (REQ-114) and the
-- week's plan (REQ-115).

-- REQ-114: a recipe we won't make again leaves the library but stays.
alter table public.recipes add column hidden boolean not null default false;

-- REQ-115: one plan at a time, started on any day. It stays open until a
-- later batch closes it (close a week and rate); `closed_at` is there for it.
create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  closed_at timestamptz,
  started_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Only one open plan: a second "Start a plan" is refused while one is open.
create unique index meal_plans_one_open on public.meal_plans ((true)) where closed_at is null;

alter table public.meal_plans enable row level security;
revoke all on public.meal_plans from anon;

-- Both of us see and edit the same plan (REQ-115).
create policy "members read plans"
  on public.meal_plans for select to authenticated
  using ((select public.is_member()));

create policy "members start plans"
  on public.meal_plans for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change plans"
  on public.meal_plans for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members remove plans"
  on public.meal_plans for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- A recipe in a plan: 4 servings (dinner and the next day's lunch) or 2
-- (one meal), and whether it's been cooked. A recipe's times planned and
-- date last planned are counted from these rows, so taking a recipe out
-- of a plan takes it out of the count too.
create table public.meal_plan_recipes (
  plan_id uuid not null references public.meal_plans (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  servings integer not null default 4 check (servings in (2, 4)),
  cooked boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (plan_id, recipe_id)
);

create index meal_plan_recipes_recipe on public.meal_plan_recipes (recipe_id);

alter table public.meal_plan_recipes enable row level security;
revoke all on public.meal_plan_recipes from anon;

create policy "members read planned recipes"
  on public.meal_plan_recipes for select to authenticated
  using ((select public.is_member()));

create policy "members plan recipes"
  on public.meal_plan_recipes for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change planned recipes"
  on public.meal_plan_recipes for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members unplan recipes"
  on public.meal_plan_recipes for delete to authenticated
  using ((select public.has_permission('use_modules')));
