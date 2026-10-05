-- Live check of the plan lifecycle (REQ-163) as a real household member,
-- against the hosted project. Needs a Member. To try it before the
-- migration is applied, put the migration above it inside begin; ... rollback;
-- (lesson 07, "Trying a migration without keeping it"). Run:
--
--   npx supabase db query --linked -f supabase/checks/plan_lifecycle.sql
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

  report := report || format(E'0. the hourly job is scheduled: %s\n', exists (select 1 from cron.job where jobname = 'meal-plan-schedule'));
  update public.meal_plans set closed_at = now() - interval '1 day', status = 'closed' where closed_at is null;

  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.recipes (name) values ('Check: lifecycle one') returning id into recipe_one;
  insert into public.recipes (name) values ('Check: lifecycle two') returning id into recipe_two;

  -- 1. A plan starts new, so does the one ahead; Start only works on the one we're on.
  current_plan := public.start_meal_plan('2030-01-06');
  ahead_plan := public.start_meal_plan('2030-01-13');
  report := report || format(E'1. both start new: %s\n', (select count(*) = 2 from public.meal_plans where id in (current_plan, ahead_plan) and status = 'new'));
  perform public.begin_meal_plan(ahead_plan);
  report := report || format(E'2. Start on the plan ahead does nothing: %s\n', (select status = 'new' from public.meal_plans where id = ahead_plan));

  -- 3. A member's Close works on a new plan too (the running app offers it on any).
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_one, 2, '2030-01-06', 'dinner') returning id into entry_one;
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_two, 1, '2030-01-08', 'dinner') returning id into entry_two;
  perform public.close_meal_plan(ahead_plan);
  report := report || format(E'3. a new plan can be closed by a member: %s\n', (select closed_at is not null and status = 'closed' from public.meal_plans where id = ahead_plan));
  ahead_plan := public.start_meal_plan('2030-01-13');

  -- 4. Start it; the system closer isn't ours to call.
  perform public.begin_meal_plan(current_plan);
  report := report || format(E'4. started: %s\n', (select status = 'started' from public.meal_plans where id = current_plan));
  begin
    perform public.close_meal_plan_system(current_plan, true);
    report := report || E'5. member calls the system closer: NOT refused (BAD)\n';
  exception when insufficient_privilege then
    report := report || E'5. member can''t call the system closer: true\n';
  end;

  -- 6. Mark one dish "Didn't cook this", then close: it isn't counted, and no rating is asked for it.
  perform public.set_didnt_cook(entry_two, true);
  perform public.close_meal_plan(current_plan);
  report := report || format(E'6. closed: %s\n', (select status = 'closed' and closed_at is not null from public.meal_plans where id = current_plan));
  report := report || format(E'7. cooked dish counts, the other doesn''t: %s\n',
    (select cooked from public.meal_plan_recipes where id = entry_one) and not (select cooked from public.meal_plan_recipes where id = entry_two));
  report := report || format(E'8. rating asked for the cooked dish only: %s\n',
    exists (select 1 from public.recipe_rating_prompts where recipe_id = recipe_one and plan_id = current_plan)
    and not exists (select 1 from public.recipe_rating_prompts where recipe_id = recipe_two and plan_id = current_plan));
  report := report || format(E'9. the plan ahead is current and still new: %s\n', (select not ahead and status = 'new' and closed_at is null from public.meal_plans where id = ahead_plan));

  -- 10. After closing, taking "Didn't cook" back counts the dish again and asks for its rating; marking it removes the question.
  perform public.set_didnt_cook(entry_two, false);
  report := report || format(E'10. dish counted and asked again: %s\n',
    (select cooked from public.meal_plan_recipes where id = entry_two) and exists (select 1 from public.recipe_rating_prompts where recipe_id = recipe_two and plan_id = current_plan));
  perform public.set_didnt_cook(entry_one, true);
  report := report || format(E'11. marked after closing: not counted, question gone: %s\n',
    not (select cooked from public.meal_plan_recipes where id = entry_one) and not exists (select 1 from public.recipe_rating_prompts where recipe_id = recipe_one and plan_id = current_plan));

  reset role;
  v_text := report;
  raise exception 'RESULTS%', v_text;
end;
$$;
