-- Meal Plan: a 2-meal dish's second meal sits on its own (REQ-196), and a
-- plan that slid remembers where it was meant to start (REQ-197).
--
-- Until now a 2-meal dish covered its meal and the very next one. Now the
-- second meal has its own place, a day plus lunch or dinner, and can be
-- anywhere after the first. An entry with no second meal written (every
-- existing one, and anything the previous app version saves) still has it
-- on the meal right after the first, so every dish keeps the meals it
-- shows today; nothing is converted here. This only ADDS, so the running
-- app keeps working until the new code is live.

alter table public.meal_plan_recipes
  add column second_on date,
  add column second_meal text check (second_meal in ('lunch', 'dinner')),
  add constraint meal_plan_second_meal_is_whole
    check ((second_on is null) = (second_meal is null));

alter table public.meal_plans
  add column slid_from date;

-- Two entries on one meal, in one plan. A 1-meal entry has its first meal; a
-- 2-meal entry also has its second (the meal after the first when none is
-- written). Replaces the version that assumed the two were side by side.
create or replace function public.plan_has_overlap(p_plan uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with slots as (
    select id,
           (meal_on - date '2000-01-01') * 2 + (meal = 'dinner')::integer as first_meal,
           case when meals = 2 then
             coalesce(
               (second_on - date '2000-01-01') * 2 + (second_meal = 'dinner')::integer,
               (meal_on - date '2000-01-01') * 2 + (meal = 'dinner')::integer + 1)
           end as second_meal_no
      from public.meal_plan_recipes
     where plan_id = p_plan and meal_on is not null
  )
  select exists (
    select 1
      from slots a
      join slots b on b.id > a.id
     where a.first_meal in (b.first_meal, b.second_meal_no)
        or a.second_meal_no in (b.first_meal, b.second_meal_no)
  );
$$;

revoke all on function public.plan_has_overlap(uuid) from public, anon;
grant execute on function public.plan_has_overlap(uuid) to authenticated;

-- Write a plan's layout in one step: the plan's start, and where each entry
-- now sits (`[{"id", "meal_on", "meal", "meals", "second_on", "second_meal"},
-- ...]`; the last two may be missing). Two entries on the same meal are
-- refused, by the check above.
create or replace function public.set_plan_layout(p_plan uuid, p_starts_on date, p_starts_meal text, p_layout jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.meal_plans set starts_on = p_starts_on, starts_meal = p_starts_meal where id = p_plan;

  update public.meal_plan_recipes e
     set meal_on = (l.value ->> 'meal_on')::date,
         meal = l.value ->> 'meal',
         meals = (l.value ->> 'meals')::integer,
         second_on = (l.value ->> 'second_on')::date,
         second_meal = l.value ->> 'second_meal'
    from jsonb_array_elements(p_layout) as l
   where e.id = (l.value ->> 'id')::uuid and e.plan_id = p_plan;

  if public.plan_has_overlap(p_plan) then
    raise exception 'Two entries are on the same meal' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.set_plan_layout(uuid, date, text, jsonb) from public, anon;
grant execute on function public.set_plan_layout(uuid, date, text, jsonb) to authenticated;

-- Eating out lands on a dinner (REQ-169): same step as before, and the
-- layout it writes carries the second meals too.
create or replace function public.push_plan_back(p_plan uuid, p_layout jsonb, p_drop uuid[], p_eating_out jsonb)
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
         meals = (l.value ->> 'meals')::integer,
         second_on = (l.value ->> 'second_on')::date,
         second_meal = l.value ->> 'second_meal'
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
