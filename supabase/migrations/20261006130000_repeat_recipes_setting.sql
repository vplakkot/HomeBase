-- Meal Plan: the setting to allow repeat recipes (REQ-172).
--
-- "Repeat recipes in a plan" is one switch for the household, off unless we
-- turn it on. Off, a recipe can appear only once across the plan we're on and
-- next week's plan together (the app refuses a second add and leaves it out of
-- the suggestions). On, it can be added more than once, so the database no
-- longer insists on one row per recipe per plan.

create table public.meal_plan_settings (
  -- One row for the household: the key can only ever be true.
  id boolean primary key default true check (id),
  repeat_recipes boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.meal_plan_settings (id) values (true);

alter table public.meal_plan_settings enable row level security;
revoke all on public.meal_plan_settings from anon;

create policy "members read meal plan settings"
  on public.meal_plan_settings for select to authenticated
  using ((select public.is_member()));

create policy "members change meal plan settings"
  on public.meal_plan_settings for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

-- A recipe may now be in a plan more than once, when the setting allows it.
-- (The app enforces the setting; the running app's own check for a recipe
-- already in a plan stays in the screen's list, which hides what is planned.)
alter table public.meal_plan_recipes drop constraint meal_plan_recipes_plan_recipe_key;
