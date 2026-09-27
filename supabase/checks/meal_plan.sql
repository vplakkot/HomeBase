-- Live check of the week's plan and hidden recipes (REQ-114, REQ-115) as
-- two real household members, against the hosted project. Needs an Admin
-- and a Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/meal_plan.sql
--
-- It writes an invented recipe and plan and ends by raising an error
-- carrying the results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  a_recipe uuid;
  a_plan uuid;
  v_count int;
  v_text text;
begin
  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  select hm.user_id into admin_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Admin' order by hm.created_at limit 1;
  if member_id is null or admin_id is null then
    raise exception 'Need an Admin and a Member to test with';
  end if;

  -- An open plan already in the project would block step 2; close it for
  -- the length of this check (undone at the end like everything else).
  update public.meal_plans set closed_at = now() where closed_at is null;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.recipes (name) values ('Check: test stew') returning id into a_recipe;

  -- 1. A member hides a recipe; it's still there.
  update public.recipes set hidden = true where id = a_recipe;
  select count(*) into v_count from public.recipes where id = a_recipe and hidden;
  report := report || format('1. a hidden recipe is kept: %s (wants 1)%s', v_count, E'\n');

  -- 2. The member starts a plan on a Tuesday; a second open plan is refused.
  insert into public.meal_plans (starts_on) values ('2026-09-29') returning id into a_plan;
  begin
    insert into public.meal_plans (starts_on) values ('2026-09-30');
    report := report || E'2. a second open plan SAVED -- WRONG\n';
  exception when unique_violation then
    report := report || E'2. a second open plan is refused (wants this)\n';
  end;

  -- 3. A recipe goes in at 4 servings by default; 3 and a second copy are refused.
  insert into public.meal_plan_recipes (plan_id, recipe_id) values (a_plan, a_recipe);
  select servings::text into v_text from public.meal_plan_recipes where plan_id = a_plan;
  report := report || format('3. default servings: %s (wants 4)%s', v_text, E'\n');
  begin
    update public.meal_plan_recipes set servings = 3 where plan_id = a_plan;
    report := report || E'3b. 3 servings SAVED -- WRONG\n';
  exception when check_violation then
    report := report || E'3b. 3 servings is refused (wants this)\n';
  end;
  begin
    insert into public.meal_plan_recipes (plan_id, recipe_id) values (a_plan, a_recipe);
    report := report || E'3c. the same recipe twice SAVED -- WRONG\n';
  exception when unique_violation then
    report := report || E'3c. the same recipe twice is refused (wants this)\n';
  end;

  -- 4. The admin sees the same plan and changes it.
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.meal_plan_recipes where plan_id = a_plan;
  report := report || format('4. the other person sees the recipe in the plan: %s (wants 1)%s', v_count, E'\n');
  update public.meal_plan_recipes set servings = 2, cooked = true where plan_id = a_plan;
  select servings || ' ' || cooked into v_text from public.meal_plan_recipes where plan_id = a_plan;
  report := report || format('4b. the other person changes it: %s (wants 2 true)%s', v_text, E'\n');

  -- 5. Removing the plan takes its recipes out of it, not out of the library.
  delete from public.meal_plans where id = a_plan;
  select count(*) into v_count from public.meal_plan_recipes where plan_id = a_plan;
  report := report || format('5. rows left after removing the plan: %s (wants 0)%s', v_count, E'\n');
  select count(*) into v_count from public.recipes where id = a_recipe;
  report := report || format('5b. the recipe is still kept: %s (wants 1)%s', v_count, E'\n');

  -- 6. Someone signed out sees nothing.
  reset role;
  set local role anon;
  begin
    select count(*) into v_count from public.meal_plans;
    report := report || format('6. signed out reads plans: %s rows -- WRONG%s', v_count, E'\n');
  exception when insufficient_privilege then
    report := report || E'6. signed out can''t read plans (wants this)\n';
  end;

  raise exception 'CHECK RESULTS (every write undone):%', report;
end $$;
