-- Live check of reopening a closed month, as real household members,
-- against the hosted project. Needs one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/reopen_month.sql
--
-- It writes an invented far-future month and ends by raising an error
-- carrying the results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  the_month uuid;
  v_count int;
  v_text text;
begin
  select hm.user_id into admin_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Admin' order by hm.created_at limit 1;
  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  if admin_id is null or member_id is null then
    raise exception 'Need one admin and one member to test with';
  end if;

  -- An invented month, closed with a closing record, written as the owner.
  insert into public.months (starts_on, closed_at, closed_by, closed_automatically, settled)
    values ('2099-01-01', now(), null, true, true) returning id into the_month;
  insert into public.month_people (month_id, user_id, percent, outstanding)
    values (the_month, admin_id, 60, 0), (the_month, member_id, 40, 0);

  -- 1. A member can't reopen it.
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reopen_month(the_month);
    report := report || E'1. a member REOPENED a month -- WRONG\n';
  exception when others then
    report := report || format('1. a member reopening is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 2. The admin can; the lock lifts and the closing record goes.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reopen_month(the_month);
  reset role;
  select count(*) into v_count from public.months
   where id = the_month and closed_at is null and settled = false and closed_automatically = false
     and reopened_at is not null and reopened_by = admin_id;
  report := report || format('2a. the admin reopens it, open and remembered as reopened: %s (wants 1)%s', v_count, E'\n');
  select count(*) into v_count from public.month_people where month_id = the_month;
  report := report || format('2b. its closing record is gone: %s rows (wants 0)%s', v_count, E'\n');

  -- 3. An open month can't be reopened again.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reopen_month(the_month);
    report := report || E'3. an open month was "reopened" -- WRONG\n';
  exception when others then
    report := report || format('3. reopening an open month is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 4. The nightly job leaves a reopened month alone.
  reset role;
  select pg_get_functiondef('public.close_squared_months()'::regprocedure) into v_text;
  report := report || format('4. the nightly job skips reopened months: %s (wants true)%s',
    v_text like '%closed_at is null and reopened_at is null%', E'\n');

  -- 5. Signed out can't call it.
  set local role anon;
  begin
    perform public.reopen_month(the_month);
    report := report || E'5. signed out REOPENED a month -- WRONG\n';
  exception when others then
    report := report || format('5. signed out is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
