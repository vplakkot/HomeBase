-- Live check of planning ahead and the plan by meal (REQ-162, REQ-164) as a
-- real household member, against the hosted project. Needs a Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/plan_by_meal.sql
--
-- It writes invented plans and ends by raising an error carrying the
-- results, which undoes every write.
do $$
declare
  member_id uuid;
  report text := E'\n';
  current_plan uuid;
  ahead_plan uuid;
  recipe_one uuid;
  entry_one uuid;
  entry_out uuid;
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

  insert into public.recipes (name) values ('Check: plan by meal') returning id into recipe_one;

  -- 1. The first plan is current; the second goes ahead and closes nothing.
  current_plan := public.start_meal_plan('2030-01-07');
  ahead_plan := public.start_meal_plan('2030-01-10');
  report := report || format(E'1. second plan is ahead, first stays open: %s\n',
    (select (ahead and closed_at is null) from public.meal_plans where id = ahead_plan)
    and (select not ahead and closed_at is null from public.meal_plans where id = current_plan));

  -- 2. A third plan is refused (one current, one ahead).
  begin
    perform public.start_meal_plan('2030-01-20');
    report := report || E'2. third plan: NOT refused (BAD)\n';
  exception when unique_violation then
    report := report || E'2. third plan refused: true\n';
  end;

  -- 3. An evening out has no recipe; reordering is one step.
  insert into public.meal_plan_recipes (plan_id, recipe_id, servings, position) values (current_plan, recipe_one, 4, 1) returning id into entry_one;
  insert into public.meal_plan_recipes (plan_id, eating_out, servings, position) values (current_plan, true, 2, 2) returning id into entry_out;
  perform public.set_plan_order(current_plan, array[entry_out, entry_one]);
  report := report || format(E'3. evening out first after reorder: %s\n',
    (select position from public.meal_plan_recipes where id = entry_out) = 1
    and (select position from public.meal_plan_recipes where id = entry_one) = 2);

  -- 4. Closing the current plan (an evening out in it asks for no rating) makes the plan ahead current.
  perform public.close_meal_plan(current_plan);
  report := report || format(E'4. plan ahead is now current: %s\n',
    (select not ahead and closed_at is null from public.meal_plans where id = ahead_plan));

  reset role;
  v_text := report;
  raise exception 'RESULTS%', v_text;
end;
$$;
