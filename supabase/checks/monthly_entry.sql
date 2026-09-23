-- Live check of monthly entry (REQ-53, 54, 55, 94), as a real household
-- member, against the hosted project. Needs one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/monthly_entry.sql
--
-- The page tests mock Supabase; this proves the database rules. Like
-- budget_year.sql it sets who is asking, switches to the signed-in role,
-- and ends by raising an error carrying the results, which undoes every
-- write. It opens January 2999 (passing that as "today"), so it never
-- touches a real month, and it adds throwaway bills to copy. Steps 11-16
-- need the bill-changes migration of 2026-09-23; step 7 needs the payments
-- migration (one-time payments carry the date paid).
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  v_month uuid;
  again uuid;
  card_row uuid;
  v_bill uuid;
  n int;
  v_new uuid;
  v_amount numeric;
  v_kind text;
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

  insert into public.bills (name, kind, due_day) values ('Check card', 'card', 22)
  returning id into v_bill;

  ---------------------------------------------------------------- member
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.open_month('2999-02-01'::date, '2999-01-15'::date);
    report := report || E'1. a month not yet running OPENED -- WRONG\n';
  exception when others then
    report := report || format('1. a later month is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  v_month := public.open_month('2999-01-01'::date, '2999-01-15'::date);
  again := public.open_month('2999-01-01'::date, '2999-01-15'::date);
  select count(*) into n from public.month_bills where month_id = v_month;
  report := report || format('2. member opens the month; opening again gives the same one: %s; bills copied: %s (wants every bill)%s',
    v_month = again, n, E'\n');

  select id into card_row from public.month_bills where month_bills.month_id = v_month and month_bills.bill_id = v_bill;

  begin
    update public.month_bills set amount = 900 where id = card_row;
    report := report || E'3. card statement saved with no personal-charges answer -- WRONG\n';
  exception when others then
    report := report || format('3. a card statement needs the answer (wants this): %s%s', sqlerrm, E'\n');
  end;

  perform public.enter_bill(card_row, 900, 'some');
  insert into public.personal_charges (month_bill_id, owner_id, amount, note)
  values (card_row, member_id, 120, 'gift');
  report := report || E'4. member enters the statement with a $120 personal charge (wants this)\n';

  begin
    insert into public.personal_charges (month_bill_id, owner_id, amount) values (card_row, admin_id, 800);
    report := report || E'5. personal charges above the statement SAVED -- WRONG\n';
  exception when others then
    report := report || format('5. charges above the statement are refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    update public.month_bills set name = 'Renamed' where id = card_row;
    report := report || E'6. member RENAMED a month''s bill -- WRONG\n';
  exception when others then
    report := report || format('6. a month''s bill keeps its copied name (wants this): %s%s', sqlerrm, E'\n');
  end;

  insert into public.direct_payments (month_id, payer_id, amount, note, paid_on)
  values (v_month, member_id, 45, 'Groceries, Venmo', '2999-01-10');
  report := report || E'7. member logs a direct payment (wants this)\n';

  perform public.enter_bill(card_row, 900, 'none');
  select count(*) into n from public.personal_charges where month_bill_id = card_row;
  report := report || format('8. answering none clears the charges: %s left (wants 0)%s', n, E'\n');

  ---------------------------------------------------------------- admin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.direct_payments where direct_payments.month_id = v_month;
  report := report || format('9. the admin sees the member''s entries: %s direct payment (wants 1)%s', n, E'\n');

  update public.bills set name = 'Check card renamed' where id = v_bill;
  select count(*) into n from public.month_bills where id = card_row and name = 'Check card';
  report := report || format('10. renaming the bill leaves the opened month''s copy: %s (wants 1)%s', n, E'\n');

  -- REQ-94, revised 2026-09-23: bill changes reach the open month only
  -- when the admin asks.
  v_new := public.save_bill(null, 'Check extra', 'other', 5, true, '2999-01-15'::date);
  select count(*) into n from public.month_bills where month_id = v_month and bill_id = v_new;
  report := report || format('11. a bill added with the tick reaches the open month: %s (wants 1)%s', n, E'\n');

  perform public.save_bill(null, 'Check unticked', 'other', 6, false, '2999-01-15'::date);
  select count(*) into n from public.month_bills where month_id = v_month and name = 'Check unticked';
  report := report || format('12. without the tick it does not: %s (wants 0)%s', n, E'\n');

  perform public.remove_bill(v_new, true, '2999-01-15'::date);
  select amount into v_amount from public.month_bills where month_id = v_month and name = 'Check extra';
  select count(*) into n from public.bills where id = v_new;
  report := report || format('13. removing a bill not yet entered: month copy $%s (wants 0), still in the list: %s (wants 0)%s',
    v_amount, n, E'\n');

  perform public.save_bill(v_bill, 'Check card', 'other', 22, true, '2999-01-15'::date);
  select kind, amount into v_kind, v_amount from public.month_bills where id = card_row;
  report := report || format('14. changing the card to other clears its entry: %s, amount %s (wants other, null)%s',
    v_kind, coalesce(v_amount::text, 'null'), E'\n');

  perform public.enter_bill(card_row, 300, null);
  perform public.remove_bill(v_bill, true, '2999-01-15'::date);
  select amount into v_amount from public.month_bills where id = card_row;
  report := report || format('15. removing a bill already entered keeps its amount: $%s (wants 300)%s', v_amount, E'\n');

  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.save_bill(null, 'Member bill', 'other', 1, true, '2999-01-15'::date);
    report := report || E'16. a member ADDED a bill -- WRONG\n';
  exception when others then
    report := report || format('16. a member can''t change the bill list (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
