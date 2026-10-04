-- Live check of the plan as a run of meals (REQ-168) as a real household
-- member, against the hosted project. Needs a Member. To try it before the
-- migration is applied, put the migration above it inside begin; ... rollback;
-- (lesson 07, "Trying a migration without keeping it"). Run:
--
--   npx supabase db query --linked -f supabase/checks/plan_run_of_meals.sql
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
  entry_three uuid;
  v_text text;
begin
  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  if member_id is null then
    raise exception 'Need a Member to test with';
  end if;

  -- A real open plan would be in the way; close it for this check (undone at the end).
  update public.meal_plans set closed_at = now() - interval '1 day' where closed_at is null;

  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.recipes (name) values ('Check: run of meals one') returning id into recipe_one;
  insert into public.recipes (name) values ('Check: run of meals two') returning id into recipe_two;

  -- 1. A plan starts at dinner by default, and at lunch when asked.
  current_plan := public.start_meal_plan('2030-01-05');
  report := report || format(E'1. starts at dinner by default: %s\n', (select starts_meal = 'dinner' from public.meal_plans where id = current_plan));

  -- 2. An entry sits on a meal with a size; Eating out is one dinner only.
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_one, 2, '2030-01-05', 'dinner') returning id into entry_one;
  insert into public.meal_plan_recipes (plan_id, eating_out, meals, meal_on, meal) values (current_plan, true, 1, '2030-01-06', 'dinner') returning id into entry_two;
  begin
    insert into public.meal_plan_recipes (plan_id, eating_out, meals, meal_on, meal) values (current_plan, true, 1, '2030-01-07', 'lunch');
    report := report || E'2. Eating out at a lunch: NOT refused (BAD)\n';
  exception when check_violation then
    report := report || E'2. Eating out at a lunch refused: true\n';
  end;

  -- 3. The layout is written in one step, and the plan's start with it.
  perform public.set_plan_layout(current_plan, '2030-01-05', 'dinner',
    jsonb_build_array(
      jsonb_build_object('id', entry_one, 'meal_on', '2030-01-07', 'meal', 'dinner', 'meals', 2),
      jsonb_build_object('id', entry_two, 'meal_on', '2030-01-06', 'meal', 'dinner', 'meals', 1)));
  report := report || format(E'3. layout saved: %s\n', (select meal_on = date '2030-01-07' from public.meal_plan_recipes where id = entry_one));

  -- 4. Two entries on one meal are refused. entry_one is a 2-meal dish from
  -- Sun 01-07 dinner, so Mon 01-08 lunch is its leftovers; a 1-meal dish
  -- moved there overlaps it (and nothing else is wrong with that move).
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_two, 1, '2030-01-09', 'dinner') returning id into entry_three;
  begin
    perform public.set_plan_layout(current_plan, '2030-01-05', 'dinner',
      jsonb_build_array(jsonb_build_object('id', entry_three, 'meal_on', '2030-01-08', 'meal', 'lunch', 'meals', 1)));
    report := report || E'4. overlap: NOT refused (BAD)\n';
  exception when check_violation then
    report := report || format(E'4. overlap refused by the layout rule: %s\n', sqlerrm = 'Two entries are on the same meal');
  end;

  -- 5. Days off can be marked and taken back by a member, and go with the plan.
  insert into public.meal_plan_days_off (plan_id, day) values (current_plan, '2030-01-08');
  delete from public.meal_plan_days_off where plan_id = current_plan and day = '2030-01-08';
  insert into public.meal_plan_days_off (plan_id, day) values (current_plan, '2030-01-09');
  report := report || format(E'5. one day off marked: %s\n', (select count(*) = 1 from public.meal_plan_days_off where plan_id = current_plan));

  reset role;
  v_text := report;
  raise exception 'RESULTS%', v_text;
end;
$$;
