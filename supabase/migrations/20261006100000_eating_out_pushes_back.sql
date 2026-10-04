-- Meal Plan: Eating out pushes dishes back (REQ-169).
--
-- Marking Eating out on a dinner that has a dish pushes that dish and every
-- later dish back a day. A dish pushed past dinner on the first Saturday
-- leaves the plan and is remembered, to be proposed first when next week's
-- plan is built. This migration adds the memory and the one database step
-- that makes the whole change at once, so two people never see a half-done
-- push. Only adds; nothing existing changes shape.

-- Recipes taken off a plan because a push ran out of week. A recipe is here
-- once; it leaves the list when it is planned again (the app removes it).
create table public.meal_plan_proposed_next (
  recipe_id uuid primary key references public.recipes (id) on delete cascade,
  reason text not null,
  proposed_at timestamptz not null default now()
);

alter table public.meal_plan_proposed_next enable row level security;
revoke all on public.meal_plan_proposed_next from anon;

create policy "members read proposed recipes"
  on public.meal_plan_proposed_next for select to authenticated
  using ((select public.is_member()));

create policy "members propose recipes"
  on public.meal_plan_proposed_next for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members clear proposed recipes"
  on public.meal_plan_proposed_next for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- Two entries on one meal, in one plan: a 2-meal dish also covers the meal
-- after it. Shared by the steps that write a layout.
create function public.plan_has_overlap(p_plan uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.meal_plan_recipes a
      join public.meal_plan_recipes b on b.plan_id = a.plan_id and b.id > a.id
     where a.plan_id = p_plan
       and a.meal_on is not null and b.meal_on is not null
       and (a.meal_on - date '2000-01-01') * 2 + (a.meal = 'dinner')::integer
             < (b.meal_on - date '2000-01-01') * 2 + (b.meal = 'dinner')::integer + b.meals
       and (b.meal_on - date '2000-01-01') * 2 + (b.meal = 'dinner')::integer
             < (a.meal_on - date '2000-01-01') * 2 + (a.meal = 'dinner')::integer + a.meals
  );
$$;

revoke all on function public.plan_has_overlap(uuid) from public, anon;
grant execute on function public.plan_has_overlap(uuid) to authenticated;

-- Eating out lands on a dinner (REQ-169), in one step: dishes that no longer
-- fit the week leave the plan and are remembered as proposed for next week;
-- the others are written where the app worked out they now sit (`p_layout`,
-- `[{"id", "meal_on", "meal", "meals"}, ...]`); and a new Eating out entry
-- is added when `p_eating_out` is given (`{"id", "meal_on"}`; moving an
-- Eating out already in the plan is a layout change). Runs as the person
-- asking, so the policies still decide who may change a plan.
create function public.push_plan_back(p_plan uuid, p_layout jsonb, p_drop uuid[], p_eating_out jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.meal_plan_proposed_next (recipe_id, reason)
  select recipe_id, 'dropped'
    from public.meal_plan_recipes
   where plan_id = p_plan and id = any (p_drop) and recipe_id is not null
  on conflict (recipe_id) do nothing;

  delete from public.meal_plan_recipes where plan_id = p_plan and id = any (p_drop);

  update public.meal_plan_recipes e
     set meal_on = (l.value ->> 'meal_on')::date,
         meal = l.value ->> 'meal',
         meals = (l.value ->> 'meals')::integer
    from jsonb_array_elements(p_layout) as l
   where e.id = (l.value ->> 'id')::uuid and e.plan_id = p_plan;

  if p_eating_out is not null then
    insert into public.meal_plan_recipes (id, plan_id, eating_out, meals, meal_on, meal)
    values ((p_eating_out ->> 'id')::uuid, p_plan, true, 1, (p_eating_out ->> 'meal_on')::date, 'dinner');
  end if;

  if public.plan_has_overlap(p_plan) then
    raise exception 'Two entries are on the same meal' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.push_plan_back(uuid, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.push_plan_back(uuid, jsonb, uuid[], jsonb) to authenticated;
