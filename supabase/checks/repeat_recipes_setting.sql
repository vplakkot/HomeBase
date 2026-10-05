-- Live check of the repeat-recipes setting (REQ-172) as a real household
-- member, against the hosted project. Needs a Member. To try it before the
-- migration is applied, put the migration above it inside begin; ... rollback;
-- (lesson 07, "Trying a migration without keeping it"). Run:
--
--   npx supabase db query --linked -f supabase/checks/repeat_recipes_setting.sql
--
-- It writes invented plans and ends by raising an error carrying the
-- results, which undoes every write.
do $$
declare
  member_id uuid;
  report text := E'\n';
  current_plan uuid;
  recipe_one uuid;
  v_text text;
begin
  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  if member_id is null then
    raise exception 'Need a Member to test with';
  end if;

  report := report || format(E'0. one row, off by default: %s\n', (select count(*) = 1 and not bool_or(repeat_recipes) from public.meal_plan_settings));
  update public.meal_plans set closed_at = now() - interval '1 day', status = 'closed' where closed_at is null;

  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A member reads and switches it.
  update public.meal_plan_settings set repeat_recipes = true where id;
  report := report || format(E'1. a member switches it on: %s\n', (select repeat_recipes from public.meal_plan_settings));
  update public.meal_plan_settings set repeat_recipes = false where id;

  -- 2. A second row can't be added: it is one setting for the household.
  begin
    insert into public.meal_plan_settings (id, repeat_recipes) values (false, true);
    report := report || E'2. second row: NOT refused (BAD)\n';
  exception when check_violation or insufficient_privilege then
    report := report || E'2. a second row is refused: true\n';
  end;

  -- 3. The same recipe can now be in one plan twice (the database no longer insists on once).
  insert into public.recipes (name) values ('Check: repeat') returning id into recipe_one;
  current_plan := public.start_meal_plan('2030-01-06');
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_one, 1, '2030-01-06', 'dinner');
  insert into public.meal_plan_recipes (plan_id, recipe_id, meals, meal_on, meal) values (current_plan, recipe_one, 1, '2030-01-07', 'dinner');
  report := report || format(E'3. the same recipe twice in a plan: %s\n', (select count(*) = 2 from public.meal_plan_recipes where plan_id = current_plan and recipe_id = recipe_one));

  reset role;
  v_text := report;
  raise exception 'RESULTS%', v_text;
end;
$$;
