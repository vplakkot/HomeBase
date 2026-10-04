-- Meal Plan: the week laid out by meal (REQ-164) and planning ahead (REQ-162).
--
-- Two things change. A plan can have a second plan queued behind it (the
-- "ahead" plan), so the open-plan rule becomes "one current, one ahead".
-- And what's in a plan is an ordered list of entries: a recipe, or an
-- evening out. Which meal an entry lands on is worked out from the order
-- and the servings, so only the order is stored.

-- REQ-162: at most one current plan and one plan ahead. Starting a plan
-- never closes another (it used to close the open one).
alter table public.meal_plans add column ahead boolean not null default false;

drop index public.meal_plans_one_open;
create unique index meal_plans_one_current on public.meal_plans ((true)) where closed_at is null and not ahead;
create unique index meal_plans_one_ahead on public.meal_plans ((true)) where closed_at is null and ahead;

-- REQ-164: an entry gets an id of its own, because an evening out has no
-- recipe to identify it by, and a place in the plan's order.
alter table public.meal_plan_recipes drop constraint meal_plan_recipes_pkey;
alter table public.meal_plan_recipes add column id uuid not null default gen_random_uuid();
alter table public.meal_plan_recipes add primary key (id);
-- A recipe is still in a plan once (evenings out have no recipe, so any
-- number of them can share the plan).
alter table public.meal_plan_recipes add constraint meal_plan_recipes_plan_recipe_key unique (plan_id, recipe_id);
alter table public.meal_plan_recipes alter column recipe_id drop not null;
alter table public.meal_plan_recipes add column eating_out boolean not null default false;
alter table public.meal_plan_recipes add column position integer not null default 0;
alter table public.meal_plan_recipes add constraint meal_plan_entry_is_a_recipe_or_eating_out check (eating_out = (recipe_id is null));

-- Plans made so far keep the order their recipes were added in.
update public.meal_plan_recipes e
   set position = ranked.place
  from (
    select id, row_number() over (partition by plan_id order by added_at, id) as place
      from public.meal_plan_recipes
  ) ranked
 where e.id = ranked.id;

create index meal_plan_recipes_plan_position on public.meal_plan_recipes (plan_id, position);

-- Put a plan's entries in the order given, in one step, so moving a dish
-- never leaves two people looking at two different orders. It runs as the
-- person asking, so the policies still decide who may change a plan.
create function public.set_plan_order(p_plan uuid, p_order uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.meal_plan_recipes e
     set position = o.place
    from unnest(p_order) with ordinality as o(entry, place)
   where e.id = o.entry and e.plan_id = p_plan;
$$;

revoke all on function public.set_plan_order(uuid, uuid[]) from public, anon;
grant execute on function public.set_plan_order(uuid, uuid[]) to authenticated;

-- Start a plan (REQ-115). With a current plan open it becomes the plan
-- ahead; it never closes anything (REQ-162). A second plan ahead is
-- refused by the unique index.
create or replace function public.start_meal_plan(p_starts_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_plan uuid;
  new_plan uuid;
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can start a plan'
      using errcode = 'insufficient_privilege';
  end if;
  select id into current_plan from public.meal_plans where closed_at is null and not ahead for update;
  insert into public.meal_plans (starts_on, started_by, ahead)
  values (p_starts_on, (select auth.uid()), current_plan is not null)
  returning id into new_plan;
  return new_plan;
end;
$$;

-- Close a plan (REQ-116). An evening out is never rated. When the current
-- plan closes, the plan ahead becomes the current one.
create or replace function public.close_meal_plan(p_plan uuid)
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
  insert into public.recipe_rating_prompts (recipe_id, user_id, plan_id)
  select mpr.recipe_id, hm.user_id, p_plan
    from public.meal_plan_recipes mpr
    cross join public.household_members hm
   where mpr.plan_id = p_plan
     and mpr.recipe_id is not null
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
  update public.meal_plans set ahead = false where closed_at is null and ahead;
end;
$$;
