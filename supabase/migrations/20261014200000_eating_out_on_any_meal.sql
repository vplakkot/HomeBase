-- Meal Plan: Eating out can be put on a lunch too (Vin, 2026-10-14: on a day
-- off a lunch out is a lunch out). Until now the table only allowed it on a
-- dinner. The one rule left is that it takes a single meal. Only relaxes a
-- rule, so the running app keeps working.

alter table public.meal_plan_recipes
  drop constraint eating_out_is_one_dinner,
  add constraint eating_out_is_one_meal
    check (not eating_out or meal is null or meals = 1);

-- Eating out lands on a meal (REQ-169), in one step, as before; the new entry
-- is written on the meal the app sends (a dinner when none is sent).
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
    values ((p_eating_out ->> 'id')::uuid, p_plan, true, 1, (p_eating_out ->> 'meal_on')::date, coalesce(p_eating_out ->> 'meal', 'dinner'));
  end if;

  if public.plan_has_overlap(p_plan) then
    raise exception 'Two entries are on the same meal' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.push_plan_back(uuid, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.push_plan_back(uuid, jsonb, uuid[], jsonb) to authenticated;
