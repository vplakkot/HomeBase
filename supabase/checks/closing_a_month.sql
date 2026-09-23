-- Live check of closing a month (REQ-59, REQ-52) and income (REQ-60), as
-- real household members, against the hosted project. Needs one Admin
-- and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/closing_a_month.sql
--
-- Like payments.sql it works in January and February 2999 (passing a day
-- there as "today") with throwaway bills and a throwaway 50/50 split,
-- and ends by raising an error carrying the results, which undoes every
-- write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  high_id uuid;
  low_id uuid;
  report text := E'\n';
  v_split uuid;
  v_rent uuid;
  v_card uuid;
  v_jan uuid;
  v_feb uuid;
  rent_row uuid;
  card_row uuid;
  v_payment uuid;
  v_text text;
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
  -- The rounding cent goes to whoever sorts last by user_id.
  high_id := greatest(admin_id, member_id);
  low_id := least(admin_id, member_id);

  insert into public.splits (effective_from) values ('2998-12-01') returning id into v_split;
  insert into public.split_shares (split_id, user_id, percent)
  values (v_split, admin_id, 50), (v_split, member_id, 50);
  -- $1,000.03 split 50/50 leaves half a cent each way.
  insert into public.bills (name, kind, due_day, amount) values ('Check rent', 'rent', 1, 1000.03) returning id into v_rent;
  insert into public.bills (name, kind, due_day) values ('Check card', 'card', 22) returning id into v_card;

  ---------------------------------------------------------------- member
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_jan := public.open_month('2999-01-01'::date, '2999-01-15'::date);
  select id into rent_row from public.month_bills where month_id = v_jan and bill_id = v_rent;
  select id into card_row from public.month_bills where month_id = v_jan and bill_id = v_card;

  begin
    perform public.close_month_with_balance(v_jan);
    report := report || E'1. a member CLOSED a month with a balance -- WRONG\n';
  exception when others then
    report := report || format('1. a member can''t close a month with a balance (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    insert into public.month_people (month_id, user_id, percent, outstanding) values (v_jan, member_id, 100, 0);
    report := report || E'2. a member WROTE a closed-month row by hand -- WRONG\n';
  exception when others then
    report := report || format('2. nobody writes the closed-month rows by hand (wants this): %s%s', sqlerrm, E'\n');
  end;

  ----------------------------------------------------------------- admin
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  begin
    perform public.close_month_with_balance(v_jan);
    report := report || E'3. a month CLOSED with a bill not entered -- WRONG\n';
  exception when others then
    report := report || format('3. a month with a bill not entered can''t close (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- The household's real bills were copied in too: enter them all at $0.
  perform public.enter_bill(mb.id, 0, case when mb.kind = 'card' then 'none' end)
    from public.month_bills mb where mb.month_id = v_jan and mb.id <> rent_row;
  insert into public.payments (month_bill_id, payer_id, amount) values (rent_row, high_id, 500.00)
  returning id into v_payment;

  select string_agg(format('%s owes %s', case when b.user_id = high_id then 'last' else 'first' end, b.outstanding), ', '
                    order by b.user_id)
    into v_text from public.month_balances(v_jan) b;
  report := report || format('4. balances: %s (wants first owes 500.02, last owes 0.01: the last takes the rounding cent)%s', v_text, E'\n');
  report := report || format('5. squared with money owed? %s (wants false)%s', public.month_is_squared(v_jan), E'\n');

  perform public.close_month_with_balance(v_jan);
  select format('closed_by admin %s, split_from %s', closed_by = admin_id, split_from)
    into v_text from public.months where id = v_jan;
  report := report || format('6. admin closes with a balance: %s (wants true, 2998-12-01)%s', v_text, E'\n');
  select string_agg(format('%s %s%% owed %s', case when user_id = high_id then 'last' else 'first' end, percent, outstanding), ', '
                    order by user_id)
    into v_text from public.month_people where month_id = v_jan;
  report := report || format('7. written on the month: %s (wants first 50%% owed 500.02, last 50%% owed 0.01)%s', v_text, E'\n');

  begin
    insert into public.payments (month_bill_id, payer_id, amount) values (rent_row, low_id, 500.02);
    report := report || E'8. a payment LOGGED in a closed month -- WRONG\n';
  exception when others then
    report := report || format('8. no new payment in a closed month (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    delete from public.payments where id = v_payment;
    get diagnostics n = row_count;
    report := report || format('9. a payment DELETED from a closed month (%s rows) -- WRONG%s', n, E'\n');
  exception when others then
    report := report || format('9. no payment deleted from a closed month (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    perform public.enter_bill(card_row, 50, 'none');
    report := report || E'10. a bill CHANGED in a closed month -- WRONG\n';
  exception when others then
    report := report || format('10. no bill changed in a closed month (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    insert into public.direct_payments (month_id, payer_id, amount, note, paid_on)
    values (v_jan, admin_id, 20, 'Check taxi', '2999-01-20');
    report := report || E'11. a one-time payment ADDED to a closed month -- WRONG\n';
  exception when others then
    report := report || format('11. no one-time payment added to a closed month (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    perform public.close_month_with_balance(v_jan);
    report := report || E'12. a closed month CLOSED again -- WRONG\n';
  exception when others then
    report := report || format('12. a closed month can''t be closed again (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- Income: a squared month can close early, so income stays open until
  -- the month is over. January 2999 isn't over yet by the real clock.
  insert into public.month_income (month_id, owner_id, kind, amount, received_on)
  values (v_jan, member_id, 'paycheck', 2500, '2999-01-10');
  report := report || E'13. income logged in a closed month that isn''t over yet (wants this)\n';
  begin
    insert into public.month_income (month_id, owner_id, kind, amount, received_on)
    values (v_jan, member_id, 'bonus', 100, '2999-02-01');
    report := report || E'14. income SAVED on a day outside its month -- WRONG\n';
  exception when others then
    report := report || format('14. income belongs to its own month (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    insert into public.month_income (month_id, owner_id, kind, amount, received_on)
    values (v_jan, member_id, 'held', 100, '2999-01-12');
    report := report || E'15. shares HELD saved as income -- WRONG\n';
  exception when others then
    report := report || format('15. there is no "held" kind of income (wants this): %s%s', sqlerrm, E'\n');
  end;

  ------------------------------------------------ a squared month (Feb)
  v_feb := public.open_month('2999-02-01'::date, '2999-02-10'::date);
  select id into rent_row from public.month_bills where month_id = v_feb and bill_id = v_rent;
  perform public.enter_bill(mb.id, 0, case when mb.kind = 'card' then 'none' end)
    from public.month_bills mb where mb.month_id = v_feb and mb.id <> rent_row;
  insert into public.payments (month_bill_id, payer_id, amount) values (rent_row, low_id, 500.02), (rent_row, high_id, 500.01);
  report := report || format('16. every bill paid, both at zero: squared? %s (wants true)%s', public.month_is_squared(v_feb), E'\n');

  reset role;

  -- REQ-52: a later change to the percentages doesn't reach a closed month.
  update public.split_shares set percent = case when user_id = admin_id then 70 else 30 end where split_id = v_split;
  select string_agg(format('%s', b.outstanding), ', ' order by b.user_id) into v_text from public.month_balances(v_jan) b;
  report := report || format('17. after the split changes to 70/30, January still owes: %s (wants 500.02, 0.01)%s', v_text, E'\n');
  report := report || format('18. and February, still open, moves with it: squared? %s (wants false)%s', public.month_is_squared(v_feb), E'\n');
  update public.split_shares set percent = 50 where split_id = v_split;

  -- What the nightly job does to a squared month.
  perform public.close_month(v_feb, null);
  select format('closed %s, closed_by empty %s', closed_at is not null, closed_by is null)
    into v_text from public.months where id = v_feb;
  report := report || format('19. a squared month closed on its own: %s (wants true, true)%s', v_text, E'\n');
  select count(*) into n from cron.job where jobname = 'close-squared-months' and schedule = '5 * * * *';
  report := report || format('20. the hourly close job is scheduled: %s (wants 1)%s', n, E'\n');

  -- Removing a bill from the household's list still works once a closed
  -- month holds a copy of it.
  delete from public.bills where id = v_rent;
  select count(*) into n from public.month_bills where month_id in (v_jan, v_feb) and bill_id is null and name = 'Check rent';
  report := report || format('21. rent removed from the list; closed months keep their copies: %s (wants 2)%s', n, E'\n');

  raise exception 'Results (all undone):%', report;
end;
$$;
