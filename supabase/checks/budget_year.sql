-- Live check of the Finances setup rules (REQ-50, 51, 94), as real
-- household members, against the hosted project. Needs at least one Admin
-- and one Member. Run it with:
--
--   npx supabase db query --linked -f supabase/checks/budget_year.sql
--
-- Every test of the setup screens mocks Supabase, so this is what proves
-- the database itself: an admin can save a split and a member can't, a
-- split that doesn't total 100 is refused, and members can read it all.
-- Like notification_log.sql it sets who is asking (request.jwt.claims),
-- switches to the signed-in role, and ends by raising an error carrying
-- the results, which undoes every write. It uses start years 2998 and
-- 2999 so it can never touch a real budget year.
--
-- The total is checked when a transaction commits, and this block never
-- commits, so it asks for the check early with SET CONSTRAINTS ... IMMEDIATE.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  n int;
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

  ---------------------------------------------------------------- admin
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.save_budget_year(2999, 'check', jsonb_build_array(
      jsonb_build_object('user_id', admin_id, 'percent', 60),
      jsonb_build_object('user_id', member_id, 'percent', 40)));
    set constraints all immediate;
    set constraints all deferred;
    report := report || E'1. admin saves a 60/40 split (wants this)\n';
  exception when others then
    report := report || format('1. admin could NOT save 60/40 -- WRONG: %s%s', sqlerrm, E'\n');
  end;

  begin
    perform public.save_budget_year(2998, 'check', jsonb_build_array(
      jsonb_build_object('user_id', admin_id, 'percent', 60),
      jsonb_build_object('user_id', member_id, 'percent', 30)));
    set constraints all immediate;
    report := report || E'2. admin SAVED a 60/30 split -- WRONG, must total 100\n';
  exception when others then
    report := report || format('2. a 60/30 split is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  set constraints all deferred;

  begin
    insert into public.budget_years (start_year) values (2998);
    set constraints all immediate;
    report := report || E'3. admin SAVED a year with no split -- WRONG\n';
  exception when others then
    report := report || E'3. a year with no split is refused (wants this)\n';
  end;
  set constraints all deferred;

  begin
    insert into public.bills (name, kind, due_day) values ('Check bill', 'card', 2);
    insert into public.income_sources (owner_id, net_amount, cadence, anchor_date)
    values (member_id, 1234.56, 'biweekly', '2999-01-01');
    report := report || E'4. admin adds a bill and an income source (wants this)\n';
  exception when others then
    report := report || format('4. admin could NOT add a bill or income -- WRONG: %s%s', sqlerrm, E'\n');
  end;

  --------------------------------------------------------------- member
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.budget_year_shares s
    join public.budget_years y on y.id = s.budget_year_id where y.start_year = 2999;
  report := report || format('5. member reads the 2999 split: %s shares (wants 2)%s', n, E'\n');

  select count(*) into n from public.bills where name = 'Check bill';
  report := report || format('6. member reads the bill list: sees %s check bill (wants 1)%s', n, E'\n');

  select count(*) into n from public.household_people() where manages_budget;
  report := report || format('7. member sees who manages the budget: %s people (wants 1 or more)%s', n, E'\n');

  begin
    perform public.save_budget_year(2998, 'forged', jsonb_build_array(
      jsonb_build_object('user_id', member_id, 'percent', 100)));
    set constraints all immediate;
    report := report || E'8. member SAVED a budget year -- WRONG\n';
  exception when others then
    report := report || E'8. member cannot save a budget year (wants this)\n';
  end;
  set constraints all deferred;

  begin
    insert into public.bills (name, kind, due_day) values ('Forged', 'other', 5);
    report := report || E'9. member ADDED a bill -- WRONG\n';
  exception when others then
    report := report || E'9. member cannot add a bill (wants this)\n';
  end;

  update public.income_sources set net_amount = 1 where anchor_date = '2999-01-01';
  get diagnostics n = row_count;
  report := report || format('10. member changed %s income sources (wants 0)%s', n, E'\n');

  ----------------------------------------------------------------- anon
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;

  begin
    select count(*) into n from public.budget_years;
    report := report || format('11. a signed-out visitor sees %s budget years (wants 0)%s', n, E'\n');
  exception when others then
    report := report || E'11. a signed-out visitor cannot read budget years (wants this)\n';
  end;

  begin
    select count(*) into n from public.household_people();
    report := report || format('12. a signed-out visitor lists %s people (wants 0)%s', n, E'\n');
  exception when others then
    report := report || E'12. a signed-out visitor cannot list the household (wants this)\n';
  end;

  reset role;
  raise exception 'RESULTS (all undone):%', report;
end $$;
