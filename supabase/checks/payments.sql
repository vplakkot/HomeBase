-- Live check of payments against bills (REQ-57, REQ-58) and the date on
-- one-time payments (REQ-55), as real household members, against the
-- hosted project. Needs one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/payments.sql
--
-- Like monthly_entry.sql it opens January 2999 (passing that as "today")
-- with throwaway bills, and ends by raising an error carrying the
-- results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  v_month uuid;
  v_rent uuid;
  v_card uuid;
  rent_row uuid;
  card_row uuid;
  v_payment uuid;
  n int;
  v_amount numeric;
  v_day date;
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

  insert into public.bills (name, kind, due_day, amount) values ('Check rent', 'rent', 1, 2000) returning id into v_rent;
  insert into public.bills (name, kind, due_day) values ('Check card', 'card', 22) returning id into v_card;

  ---------------------------------------------------------------- member
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_month := public.open_month('2999-01-01'::date, '2999-01-15'::date);
  select id into rent_row from public.month_bills where month_id = v_month and bill_id = v_rent;
  select id into card_row from public.month_bills where month_id = v_month and bill_id = v_card;

  -- The app refuses a payment toward a bill with no amount; the database
  -- no longer does (2026-10-03), so this only records what it allows.
  insert into public.payments (month_bill_id, payer_id, amount) values (card_row, member_id, 10);
  delete from public.payments where month_bill_id = card_row;
  report := report || E'1. the database takes a payment toward a bill not entered; the app is what asks for the amount first (wants this)\n';

  perform public.enter_bill(rent_row, 2000, null);
  perform public.enter_bill(card_row, 600, 'none');
  insert into public.payments (month_bill_id, payer_id, amount) values (card_row, member_id, 150)
  returning id into v_payment;
  insert into public.payments (month_bill_id, payer_id, amount) values (rent_row, admin_id, 2000);
  report := report || E'2. member logs $150 of their own toward the card and $2,000 of the admin''s toward rent (wants this)\n';

  insert into public.payments (month_bill_id, payer_id, amount) values (card_row, member_id, 450.01);
  report := report || E'3. a payment above what''s left is saved (wants this; Vin, 2026-09-29)\n';
  delete from public.payments where month_bill_id = card_row and amount = 450.01;

  update public.payments set amount = 601 where id = v_payment;
  report := report || E'4. a payment changed to more than the bill is saved (wants this)\n';

  select paid_on into v_day from public.payments where id = v_payment;
  report := report || format('5. a payment logged without a day gets today''s: %s (wants a date)%s', v_day, E'\n');

  update public.payments set paid_on = '2999-01-10' where id = v_payment;
  select paid_on into v_day from public.payments where id = v_payment;
  report := report || format('5b. its day can be changed: %s (wants 2999-01-10)%s', v_day, E'\n');

  perform public.enter_bill(card_row, 500, 'none');
  report := report || E'6. the statement can drop below what''s paid (wants this)\n';

  delete from public.payments where id = v_payment;
  select count(*) into n from public.payments where month_bill_id = card_row;
  report := report || format('7. member deletes the payment: %s left on the card (wants 0)%s', n, E'\n');

  begin
    insert into public.direct_payments (month_id, payer_id, amount, note)
    values (v_month, member_id, 20, 'Taxi');
    report := report || E'8. a one-time payment with no date SAVED -- WRONG\n';
  exception when others then
    report := report || format('8. a one-time payment needs its date (wants this): %s%s', sqlerrm, E'\n');
  end;

  ---------------------------------------------------------------- admin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.payments p join public.month_bills mb on mb.id = p.month_bill_id
   where mb.month_id = v_month;
  report := report || format('9. the admin sees the payments the member logged: %s (wants 1)%s', n, E'\n');

  perform public.save_bill(v_rent, 'Check rent', 'other', 1, null, true, '2999-01-15'::date);
  select amount into v_amount from public.month_bills where id = rent_row;
  report := report || format('10. rent changed to other keeps the month''s amount: $%s (wants 2000)%s', v_amount, E'\n');

  perform public.save_bill(v_rent, 'Check rent', 'card', 1, null, true, '2999-01-15'::date);
  report := report || E'11. a paid bill can switch to a card in the open month (wants this; its payments then read as a credit)\n';

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
