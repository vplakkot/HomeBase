-- Live check of a 2-meal dish's second meal sitting on its own (REQ-196) as
-- a real household member, against the hosted project. Needs a Member. To
-- try it before the migration is applied, put the migration above it inside
-- begin; ... rollback; (lesson 07, "Trying a migration without keeping it").
-- Run:
--
--   npx supabase db query --linked -f supabase/checks/plan_second_meal.sql
--
-- It writes invented plans and ends by raising an error carrying the
-- results, which undoes every write.
do $$
declare
  member_id uuid;
  report text := E'\n';
  current_plan uuid;
  recipe_one uuid;
  recipe_two uuid;
  entry_one uuid;
  entry_two uuid;
  v_text text;
begin
  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  if member_id is null then
    raise exception 'Need a Member to test with';
  end if;

  update public.meal_plans set closed_at = now() - interval '1 day' where closed_at is null;
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.recipes (name) values ('Check: second one') returning id into recipe_one;
  insert into public.recipes (name) values ('Check: second two') returning id into recipe_two;
  current_plan := public.start_meal_plan('2030-01-06');
  -- A dish with no second meal written: Tue 01-08 dinner, so Wed lunch (as every dish saved before this change).
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_one, 2, '2030-01-08', 'dinner') returning id into entry_one;
  -- A dish with its second meal written, apart from the first: Fri 01-11 lunch, Sat 01-12 dinner.
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal, second_on, second_meal) values (current_plan, recipe_two, 2, '2030-01-11', 'lunch', '2030-01-12', 'dinner') returning id into entry_two;

  report := report || format(E'1. no overlap between the two dishes: %s\n', not public.plan_has_overlap(current_plan));

  -- 2. A 1-meal dish on Wed lunch is on the first dish's unwritten second meal: refused.
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_two, 1, '2030-01-09', 'lunch');
  report := report || format(E'2. a dish on the unwritten second meal is an overlap: %s\n', public.plan_has_overlap(current_plan));
  delete from public.meal_plan_recipes where plan_id = current_plan and meals = 1;

  -- 3. A 1-meal dish on Fri dinner, between the second dish's two meals, is fine.
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_one, 1, '2030-01-11', 'dinner');
  report := report || format(E'3. a dish between the two meals of another is fine: %s\n', not public.plan_has_overlap(current_plan));
  delete from public.meal_plan_recipes where plan_id = current_plan and meals = 1;

  -- 4. Writing a layout saves the second meal; one with a second meal on another dish's meal is refused.
  perform public.set_plan_layout(current_plan, date '2030-01-06', 'dinner',
    jsonb_build_array(jsonb_build_object('id', entry_two, 'meal_on', '2030-01-11', 'meal', 'lunch', 'meals', 2, 'second_on', '2030-01-13', 'second_meal', 'dinner')));
  report := report || format(E'4. second meal written by a layout: %s\n', (select second_on = date '2030-01-13' and second_meal = 'dinner' from public.meal_plan_recipes where id = entry_two));
  begin
    perform public.set_plan_layout(current_plan, date '2030-01-06', 'dinner',
      jsonb_build_array(jsonb_build_object('id', entry_two, 'meal_on', '2030-01-11', 'meal', 'lunch', 'meals', 2, 'second_on', '2030-01-09', 'second_meal', 'lunch')));
    report := report || E'5. overlap: NOT refused (BAD)\n';
  exception when check_violation then
    report := report || format(E'5. overlap refused: %s\n', sqlerrm = 'Two entries are on the same meal');
  end;

  -- 6. A layout without second meals (the previous app version) leaves them on the meal after the first.
  perform public.set_plan_layout(current_plan, date '2030-01-06', 'dinner',
    jsonb_build_array(jsonb_build_object('id', entry_two, 'meal_on', '2030-01-11', 'meal', 'lunch', 'meals', 2)));
  report := report || format(E'6. second meal cleared, so it follows the first: %s\n', (select second_on is null and second_meal is null from public.meal_plan_recipes where id = entry_two));

  -- 7. A plan remembers where it slid from.
  update public.meal_plans set slid_from = '2030-01-01' where id = current_plan;
  report := report || format(E'7. slid_from kept: %s\n', (select slid_from = date '2030-01-01' from public.meal_plans where id = current_plan));

  reset role;
  v_text := report;
  raise exception 'RESULTS%', v_text;
end;
$$;
