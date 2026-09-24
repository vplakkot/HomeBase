-- Live check of account balances (REQ-67), as a real household member,
-- against the hosted project. Needs one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/balances.sql
--
-- It writes balances for January 2999 and ends by raising an error
-- carrying the results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  v_count int;
  v_amount numeric;
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

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A member enters both people's balances, skipping some, the way
  --    the page does.
  insert into public.balances (month, user_id, account, amount)
  values ('2999-01-01', member_id, 'cash', 1500), ('2999-01-01', member_id, '401k', 0),
         ('2999-01-01', admin_id, 'espp', 9000.50)
  on conflict (month, user_id, account) do update set amount = excluded.amount;
  select count(*) into v_count from public.balances where month = '2999-01-01';
  report := report || format('1. a member enters both people''s: %s rows (wants 3)%s', v_count, E'\n');

  -- 2. Saving again corrects a figure.
  insert into public.balances (month, user_id, account, amount)
  values ('2999-01-01', member_id, 'cash', 1750)
  on conflict (month, user_id, account) do update set amount = excluded.amount;
  select amount into v_amount from public.balances
   where month = '2999-01-01' and user_id = member_id and account = 'cash';
  report := report || format('2. saving again corrects it: %s (wants 1750.00)%s', v_amount, E'\n');

  -- 3. A negative amount, an unknown account and a mid-month date are refused.
  begin
    insert into public.balances (month, user_id, account, amount) values ('2999-01-01', member_id, 'rsu', -1);
    report := report || E'3a. a negative amount SAVED -- WRONG\n';
  exception when others then
    report := report || format('3a. a negative amount is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    insert into public.balances (month, user_id, account, amount) values ('2999-01-01', member_id, 'crypto', 1);
    report := report || E'3b. an unknown account SAVED -- WRONG\n';
  exception when others then
    report := report || format('3b. an unknown account is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    insert into public.balances (month, user_id, account, amount) values ('2999-01-15', member_id, 'rsu', 1);
    report := report || E'3c. a mid-month date SAVED -- WRONG\n';
  exception when others then
    report := report || format('3c. a mid-month date is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 4. Clearing one box removes just that row; the rest stay.
  delete from public.balances
   where month = '2999-01-01' and user_id = member_id and account in ('401k');
  select count(*) into v_count from public.balances where month = '2999-01-01';
  report := report || format('4. clearing one box leaves the rest: %s rows (wants 2)%s', v_count, E'\n');

  -- 5. Removing the month takes everything away.
  delete from public.balances where month = '2999-01-01';
  select count(*) into v_count from public.balances where month = '2999-01-01';
  report := report || format('5. removing the month leaves %s rows (wants 0)%s', v_count, E'\n');

  -- 6. Someone signed out sees none of it.
  reset role;
  set local role anon;
  begin
    select count(*) into v_count from public.balances;
    report := report || format('6. signed out sees %s rows (wants refused or 0)%s', v_count, E'\n');
  exception when others then
    report := report || format('6. signed out is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
