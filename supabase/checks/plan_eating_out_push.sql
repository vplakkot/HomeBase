-- Live check of Eating out pushing dishes back (REQ-169) as a real household
-- member, against the hosted project. Needs a Member. To try it before the
-- migration is applied, put the migration above it inside begin; ... rollback;
-- (lesson 07, "Trying a migration without keeping it"). Run:
--
--   npx supabase db query --linked -f supabase/checks/plan_eating_out_push.sql
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
  out_id uuid := gen_random_uuid();
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

  insert into public.recipes (name) values ('Check: push one') returning id into recipe_one;
  insert into public.recipes (name) values ('Check: push two') returning id into recipe_two;
  current_plan := public.start_meal_plan('2030-01-06');
  -- A 2-meal dish on Tue 01-08 dinner (leftovers Wed lunch), a 1-meal dish on Sat 01-12 dinner.
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_one, 2, '2030-01-08', 'dinner') returning id into entry_one;
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_two, 1, '2030-01-12', 'dinner') returning id into entry_two;

  -- 1. Eating out on Tue dinner: the first dish moves to Wed dinner, the Saturday one is dropped, Eating out is added.
  perform public.push_plan_back(
    current_plan,
    jsonb_build_array(jsonb_build_object('id', entry_one, 'meal_on', '2030-01-09', 'meal', 'dinner', 'meals', 2)),
    array[entry_two],
    jsonb_build_object('id', out_id, 'meal_on', '2030-01-08'));
  report := report || format(E'1. first dish pushed to Wed dinner: %s\n', (select meal_on = date '2030-01-09' and meal = 'dinner' from public.meal_plan_recipes where id = entry_one));
  report := report || format(E'2. Eating out added on Tue dinner: %s\n', (select eating_out and meal_on = date '2030-01-08' and meal = 'dinner' and meals = 1 from public.meal_plan_recipes where id = out_id));
  report := report || format(E'3. last dish taken off the plan: %s\n', not exists (select 1 from public.meal_plan_recipes where id = entry_two));
  report := report || format(E'4. and remembered as proposed: %s\n', exists (select 1 from public.meal_plan_proposed_next where recipe_id = recipe_two and reason = 'dropped'));

  -- 5. A push that leaves two entries on one meal is refused.
  begin
    perform public.push_plan_back(current_plan,
      jsonb_build_array(jsonb_build_object('id', entry_one, 'meal_on', '2030-01-08', 'meal', 'dinner', 'meals', 2)), array[]::uuid[], null);
    report := report || E'5. overlap: NOT refused (BAD)\n';
  exception when check_violation then
    report := report || format(E'5. overlap refused by the layout rule: %s\n', sqlerrm = 'Two entries are on the same meal');
  end;

  -- 6. A recipe proposed again is kept once; planning it again clears it.
  insert into public.meal_plan_proposed_next (recipe_id, reason) values (recipe_two, 'dropped') on conflict do nothing;
  delete from public.meal_plan_proposed_next where recipe_id = recipe_two;
  report := report || format(E'6. cleared when planned again: %s\n', not exists (select 1 from public.meal_plan_proposed_next where recipe_id = recipe_two));

  reset role;
  v_text := report;
  raise exception 'RESULTS%', v_text;
end;
$$;
