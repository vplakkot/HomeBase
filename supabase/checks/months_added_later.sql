-- Live check of months added later (REQ-148), as a real household
-- member, against the hosted project. Needs one Admin, one Member and a
-- split. Run:
--
--   npx supabase db query --linked -f supabase/checks/months_added_later.sql
--
-- It pretends today is 15 September 2999, so the budget year runs from
-- April 2999, and ends by raising an error carrying the results, which
-- undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  v_may uuid;
  v_again uuid;
  v_count integer;
  v_total numeric;
  v_top numeric;
  v_flag boolean;
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

  ---------------------------------------------------------------- member
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  foreach v_text in array array['2999-09-01', '2999-03-01', '2999-10-01'] loop
    begin
      perform public.add_past_month(v_text::date, '2999-09-15'::date);
      report := report || format('1. %s ADDED -- WRONG%s', v_text, E'\n');
    exception when others then
      report := report || format('1. %s refused (wants this): %s%s', v_text, sqlerrm, E'\n');
    end;
  end loop;

  v_may := public.add_past_month('2999-05-20'::date, '2999-09-15'::date);
  select added_later into v_flag from public.months where id = v_may;
  select count(*) into v_count from public.month_bills where month_id = v_may;
  report := report || format('2. a member adds May 2999: added later %s, %s bills copied in (wants t, the bill list''s %s)%s',
    v_flag, v_count, (select count(*) from public.bills), E'\n');

  select coalesce(sum(percent), 0), count(*) into v_total, v_count from public.month_shares where month_id = v_may;
  report := report || format('3. it has its own split: %s people, %s%% (wants the split''s people, 100)%s', v_count, v_total, E'\n');

  begin
    v_again := public.add_past_month('2999-05-01'::date, '2999-09-15'::date);
    report := report || E'4. May ADDED TWICE -- WRONG\n';
  exception when others then
    report := report || format('4. May can''t be added twice (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    perform public.set_month_split(v_may, jsonb_build_array(
      jsonb_build_object('user_id', admin_id, 'percent', 60),
      jsonb_build_object('user_id', member_id, 'percent', 30)));
    report := report || E'5. a split of 90% SAVED -- WRONG\n';
  exception when others then
    report := report || format('5. a split must total 100 (wants this): %s%s', sqlerrm, E'\n');
  end;

  perform public.set_month_split(v_may, jsonb_build_array(
    jsonb_build_object('user_id', admin_id, 'percent', 70),
    jsonb_build_object('user_id', member_id, 'percent', 30)));
  select percent into v_total from public.month_shares where month_id = v_may and user_id = admin_id;
  select count(*) into v_count from public.splits where effective_from = '2999-05-01';
  report := report || format('6. May''s split changed to 70/30: admin %s%%; household splits for May 2999: %s (wants 70, 0)%s',
    v_total, v_count, E'\n');

  begin
    perform public.settle_past_month(v_may);
    report := report || E'7. SETTLED with bills still to enter -- WRONG\n';
  exception when others then
    report := report || format('7. every bill first (wants this): %s%s', sqlerrm, E'\n');
  end;

  update public.month_bills
     set amount = 100, personal_answer = case when kind = 'card' then 'none' end, entered_at = now()
   where month_id = v_may;
  insert into public.direct_payments (month_id, payer_id, amount, note, paid_on)
  values (v_may, admin_id, 50, 'Check groceries', '2999-05-10');

  ---------------------------------------------------------------- the database's own eyes
  reset role;
  select percent into v_total from public.month_balances(v_may) where user_id = admin_id;
  report := report || format('8. May divides by its own split: admin at %s%% (wants 70)%s', v_total, E'\n');

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.settle_past_month(v_may);
  select settled and closed_at is not null and split_from is null into v_flag from public.months where id = v_may;
  select coalesce(sum(abs(outstanding)), -1), coalesce(max(percent), 0) into v_total, v_top
    from public.month_people where month_id = v_may;
  report := report || format('9. a member settles May: closed and settled %s, owed in all $%s, top share %s%% (wants t, 0, 70)%s',
    v_flag, v_total, v_top, E'\n');

  begin
    insert into public.direct_payments (month_id, payer_id, amount, note, paid_on)
    values (v_may, admin_id, 5, 'Check late', '2999-05-11');
    report := report || E'10. a payment ADDED to a settled month -- WRONG\n';
  exception when others then
    report := report || format('10. a settled month is locked (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    perform public.set_month_split(v_may, jsonb_build_array(
      jsonb_build_object('user_id', admin_id, 'percent', 50),
      jsonb_build_object('user_id', member_id, 'percent', 50)));
    report := report || E'11. a settled month''s split CHANGED -- WRONG\n';
  exception when others then
    report := report || format('11. a settled month''s split stays (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
