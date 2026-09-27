-- Meal Plan batch 3: closing a week and rating new dishes (REQ-116).
--
-- Closing a plan is one step, like signing off a week: everything in it
-- counts as cooked except what we carry over, and every recipe cooked for
-- the first time asks each of us for a rating, on our own device. Starting
-- a new plan closes the open one first, so either of us can just start.

-- REQ-116: a recipe we didn't get to is carried over. It isn't cooked,
-- isn't rated, isn't counted as planned, and is proposed first next time.
alter table public.meal_plan_recipes
  add column carry_over boolean not null default false,
  add constraint carried_over_is_not_cooked check (not (carry_over and cooked));

-- A closed plan is a record: its recipes can't be added, changed or taken
-- off, even from a screen left open since before the other person closed
-- it. Reopening the plan (below) makes it changeable again.
-- Only an open plan's start day can be changed directly, and closing or
-- reopening goes through the functions below, so the rating questions
-- and cooked ticks always go with it.
drop policy "members change plans" on public.meal_plans;

create policy "members change open plans"
  on public.meal_plans for update to authenticated
  using ((select public.has_permission('use_modules')) and closed_at is null)
  with check ((select public.has_permission('use_modules')) and closed_at is null);

drop policy "members plan recipes" on public.meal_plan_recipes;
drop policy "members change planned recipes" on public.meal_plan_recipes;
drop policy "members unplan recipes" on public.meal_plan_recipes;

create function public.plan_is_open(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.meal_plans where id = p_plan and closed_at is null);
$$;

revoke all on function public.plan_is_open(uuid) from public, anon;
grant execute on function public.plan_is_open(uuid) to authenticated;

create policy "members plan recipes in an open plan"
  on public.meal_plan_recipes for insert to authenticated
  with check ((select public.has_permission('use_modules')) and public.plan_is_open(plan_id));

create policy "members change recipes in an open plan"
  on public.meal_plan_recipes for update to authenticated
  using ((select public.has_permission('use_modules')) and public.plan_is_open(plan_id))
  with check ((select public.has_permission('use_modules')) and public.plan_is_open(plan_id));

create policy "members unplan recipes from an open plan"
  on public.meal_plan_recipes for delete to authenticated
  using ((select public.has_permission('use_modules')) and public.plan_is_open(plan_id));

-- One rating per person per recipe, whole stars 1 to 5, like a drink's
-- (REQ-29). Rating again replaces it. Removing the recipe removes them.
create table public.recipe_ratings (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references public.household_members (user_id) on delete cascade default auth.uid(),
  stars smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);

alter table public.recipe_ratings enable row level security;
revoke all on public.recipe_ratings from anon;

-- Everyone sees every rating, by name (REQ-110). Each person writes only
-- their own, so even a hand-made request can't rate for someone else.
create policy "members read recipe ratings"
  on public.recipe_ratings for select to authenticated
  using ((select public.is_member()));

create policy "members rate recipes for themselves"
  on public.recipe_ratings for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_permission('use_modules')));

create policy "members change their own recipe rating"
  on public.recipe_ratings for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()))
  with check (user_id = (select auth.uid()) and (select public.has_permission('use_modules')));

create policy "members remove their own recipe rating"
  on public.recipe_ratings for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

create trigger stamp_rating_change
  before insert or update on public.recipe_ratings
  for each row execute function public.stamp_rating_change();

create index recipe_ratings_user on public.recipe_ratings (user_id);

-- "Rate what we cooked": one row per person per recipe to rate. Closing a
-- plan writes them; answering or skipping removes your own. Each person
-- sees only theirs.
create table public.recipe_rating_prompts (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references public.household_members (user_id) on delete cascade,
  -- The plan whose closing asked, so reopening it takes the question back.
  plan_id uuid not null references public.meal_plans (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);

create index recipe_rating_prompts_user on public.recipe_rating_prompts (user_id);
create index recipe_rating_prompts_plan on public.recipe_rating_prompts (plan_id);

alter table public.recipe_rating_prompts enable row level security;
revoke all on public.recipe_rating_prompts from anon;

create policy "members read their own rating prompts"
  on public.recipe_rating_prompts for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

create policy "members skip their own rating prompts"
  on public.recipe_rating_prompts for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

-- A rating answers the question: rating a recipe removes your prompt for it.
create function public.answer_rating_prompt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.recipe_rating_prompts where recipe_id = new.recipe_id and user_id = new.user_id;
  return new;
end;
$$;

create trigger answer_rating_prompt
  after insert or update on public.recipe_ratings
  for each row execute function public.answer_rating_prompt();

-- Close a plan. A plan the other person already closed is left alone.
create function public.close_meal_plan(p_plan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can close a plan'
      using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.meal_plans where id = p_plan and closed_at is null for update;
  if not found then
    return;
  end if;
  -- First time cooked: never cooked in a plan closed before this one.
  -- Everyone who hasn't rated it yet is asked.
  insert into public.recipe_rating_prompts (recipe_id, user_id, plan_id)
  select mpr.recipe_id, hm.user_id, p_plan
    from public.meal_plan_recipes mpr
    cross join public.household_members hm
   where mpr.plan_id = p_plan
     and not mpr.carry_over
     and not exists (
       select 1
         from public.meal_plan_recipes earlier
         join public.meal_plans p on p.id = earlier.plan_id
        where earlier.recipe_id = mpr.recipe_id
          and earlier.plan_id <> p_plan
          and earlier.cooked
          and p.closed_at is not null)
     and not exists (
       select 1 from public.recipe_ratings rr
        where rr.recipe_id = mpr.recipe_id and rr.user_id = hm.user_id)
  on conflict do nothing;
  update public.meal_plan_recipes set cooked = not carry_over where plan_id = p_plan;
  update public.meal_plans set closed_at = now() where id = p_plan;
end;
$$;

revoke all on function public.close_meal_plan(uuid) from public, anon;
grant execute on function public.close_meal_plan(uuid) to authenticated;

-- Start a plan (REQ-115), closing the open one first (REQ-116).
create function public.start_meal_plan(p_starts_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_plan uuid;
  new_plan uuid;
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can start a plan'
      using errcode = 'insufficient_privilege';
  end if;
  select id into open_plan from public.meal_plans where closed_at is null for update;
  if open_plan is not null then
    perform public.close_meal_plan(open_plan);
  end if;
  insert into public.meal_plans (starts_on, started_by)
  values (p_starts_on, (select auth.uid()))
  returning id into new_plan;
  return new_plan;
end;
$$;

revoke all on function public.start_meal_plan(date) from public, anon;
grant execute on function public.start_meal_plan(date) to authenticated;

-- Nothing is stuck: the last plan closed by mistake can open again while
-- no other plan is open. Its unanswered rating questions are taken back;
-- ratings already given stay, and closing again asks only the rest.
create function public.reopen_meal_plan(p_plan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can reopen a plan'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.meal_plans where closed_at is null) then
    raise exception 'Another plan is open'
      using errcode = 'unique_violation';
  end if;
  if p_plan is distinct from (select id from public.meal_plans where closed_at is not null order by closed_at desc limit 1) then
    raise exception 'Only the last plan closed can be reopened'
      using errcode = 'check_violation';
  end if;
  delete from public.recipe_rating_prompts where plan_id = p_plan;
  update public.meal_plans set closed_at = null where id = p_plan;
end;
$$;

revoke all on function public.reopen_meal_plan(uuid) from public, anon;
grant execute on function public.reopen_meal_plan(uuid) to authenticated;
