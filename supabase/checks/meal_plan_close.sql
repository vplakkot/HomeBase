-- Live check of closing a week and rating (REQ-116) as two real household
-- members, against the hosted project. Needs an Admin and a Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/meal_plan_close.sql
--
-- It writes invented recipes and plans and ends by raising an error
-- carrying the results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  cooked_before uuid;
  first_time uuid;
  carried uuid;
  plan_one uuid;
  plan_two uuid;
  plan_three uuid;
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

  -- A real open plan would be closed by step 1; close it for the length
  -- of this check (undone at the end like everything else).
  update public.meal_plans set closed_at = now() - interval '1 day' where closed_at is null;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.recipes (name) values ('Check: cooked before') returning id into cooked_before;
  insert into public.recipes (name) values ('Check: first time') returning id into first_time;
  insert into public.recipes (name) values ('Check: carried') returning id into carried;

  -- 1. A first plan with "cooked before", closed: it's cooked for the first time then.
  plan_one := public.start_meal_plan('2026-09-13');
  insert into public.meal_plan_recipes (plan_id, recipe_id) values (plan_one, cooked_before);
  perform public.close_meal_plan(plan_one);
  select count(*) into v_count from public.recipe_rating_prompts where recipe_id = cooked_before;
  report := report || format('1. the member sees their own prompt for a first cook: %s (wants 1)%s', v_count, E'\n');
  delete from public.recipe_rating_prompts where recipe_id = cooked_before;  -- skip

  -- 2. A second plan: cooked before again, a first-time dish, a carry-over.
  --    Starting a third closes it without a separate close.
  plan_two := public.start_meal_plan('2026-09-20');
  insert into public.meal_plan_recipes (plan_id, recipe_id) values (plan_two, cooked_before), (plan_two, first_time), (plan_two, carried);
  update public.meal_plan_recipes set carry_over = true where plan_id = plan_two and recipe_id = carried;
  plan_three := public.start_meal_plan('2026-09-27');
  select closed_at is not null into v_text from public.meal_plans where id = plan_two;
  report := report || format('2. starting a plan closed the open one: %s (wants true)%s', v_text, E'\n');
  select string_agg(r.name || '=' || mpr.cooked, ', ' order by r.name) into v_text
    from public.meal_plan_recipes mpr join public.recipes r on r.id = mpr.recipe_id where mpr.plan_id = plan_two;
  report := report || format('2b. cooked: %s (wants carried=false, the others true)%s', v_text, E'\n');

  -- 3. Only the first-time dish asks; each person has their own question.
  select string_agg(r.name, ', ') into v_text
    from public.recipe_rating_prompts p join public.recipes r on r.id = p.recipe_id;
  report := report || format('3. member is asked about: %s (wants Check: first time)%s', v_text, E'\n');
  insert into public.meal_plan_recipes (plan_id, recipe_id, carry_over) values (plan_three, carried, true);
  begin
    update public.meal_plan_recipes set cooked = true where plan_id = plan_three and recipe_id = carried;
    report := report || E'3b. carried over AND cooked SAVED -- WRONG\n';
  exception when check_violation then
    report := report || E'3b. carried over can''t also be cooked (wants this)\n';
  end;

  begin
    insert into public.meal_plan_recipes (plan_id, recipe_id) values (plan_one, first_time);
    report := report || E'3c. adding to a closed plan SAVED -- WRONG\n';
  exception when insufficient_privilege then
    report := report || E'3c. a closed plan can''t be added to (wants this)\n';
  end;
  update public.meal_plan_recipes set servings = 2 where plan_id = plan_one;
  get diagnostics v_count = row_count;
  report := report || format('3d. changing a closed plan''s recipes changed %s (wants 0)%s', v_count, E'\n');

  update public.meal_plans set closed_at = null where id = plan_one;
  get diagnostics v_count = row_count;
  report := report || format('3e. reopening a plan by hand, not through reopen, changed %s (wants 0)%s', v_count, E'\n');
  begin
    update public.meal_plans set closed_at = now() where id = plan_three;
    report := report || E'3f. closing a plan by hand SAVED -- WRONG\n';
  exception when insufficient_privilege then
    report := report || E'3f. closing a plan by hand is refused (wants this)\n';
  end;

  -- 4. Rating answers the question; rating for someone else is refused.
  insert into public.recipe_ratings (recipe_id, user_id, stars) values (first_time, member_id, 4);
  select count(*) into v_count from public.recipe_rating_prompts where recipe_id = first_time;
  report := report || format('4. member''s question after rating: %s (wants 0)%s', v_count, E'\n');
  begin
    insert into public.recipe_ratings (recipe_id, user_id, stars) values (first_time, admin_id, 5);
    report := report || E'4b. rating for the other person SAVED -- WRONG\n';
  exception when insufficient_privilege then
    report := report || E'4b. rating for the other person is refused (wants this)\n';
  end;

  -- 5. The admin still has their own question, and sees the member's rating.
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.recipe_rating_prompts where recipe_id = first_time;
  report := report || format('5. admin''s own question still there: %s (wants 1)%s', v_count, E'\n');
  select count(*) into v_count from public.recipe_ratings where recipe_id = first_time;
  report := report || format('5b. admin sees the member''s rating: %s (wants 1)%s', v_count, E'\n');
  begin
    delete from public.recipe_ratings where recipe_id = first_time and user_id = member_id;
    get diagnostics v_count = row_count;
    report := report || format('5c. admin removing the member''s rating removed %s (wants 0)%s', v_count, E'\n');
  end;

  -- 6. Reopening: refused while plan three is open; allowed for the last closed once it's gone.
  begin
    perform public.reopen_meal_plan(plan_two);
    report := report || E'6. reopening while another plan is open WORKED -- WRONG\n';
  exception when unique_violation then
    report := report || E'6. reopening while another plan is open is refused (wants this)\n';
  end;
  delete from public.meal_plans where id = plan_three;
  -- Inside one transaction every close has the same time; set plan one's apart.
  -- (as the database owner: members can't change a closed plan).
  reset role;
  update public.meal_plans set closed_at = closed_at - interval '1 hour' where id = plan_one;
  set local role authenticated;
  perform public.reopen_meal_plan(plan_two);
  select count(*) into v_count from public.meal_plans where id = plan_two and closed_at is null;
  report := report || format('6b. the last plan reopened: %s (wants 1)%s', v_count, E'\n');
  select count(*) into v_count from public.recipe_rating_prompts where plan_id = plan_two;
  report := report || format('6c. its unanswered questions taken back (admin view): %s (wants 0)%s', v_count, E'\n');

  -- 7. Someone signed out sees nothing and can't close plans.
  reset role;
  set local role anon;
  begin
    select count(*) into v_count from public.recipe_ratings;
    report := report || format('7. signed out reads ratings: %s rows -- WRONG%s', v_count, E'\n');
  exception when insufficient_privilege then
    report := report || E'7. signed out can''t read ratings (wants this)\n';
  end;
  begin
    perform public.close_meal_plan(plan_two);
    report := report || E'7b. signed out closed a plan -- WRONG\n';
  exception when insufficient_privilege then
    report := report || E'7b. signed out can''t close a plan (wants this)\n';
  end;

  raise exception 'CHECK RESULTS (every write undone):%', report;
end $$;
