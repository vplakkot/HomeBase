-- Live check of rent carrying its amount (Vin, 2026-09-23; changes
-- REQ-94), as real household members, against the hosted project. Needs
-- one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/rent_amount.sql
--
-- Like monthly_entry.sql it opens January 2999 (passing that as "today")
-- and ends by raising an error carrying the results, which undoes every
-- write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  v_month uuid;
  v_rent uuid;
  v_card uuid;
  rent_row uuid;
  v_amount numeric;
  v_entered timestamptz;
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
    perform public.save_bill(null, 'Check rent', 'rent', 1, null, false, '2999-01-15'::date);
    report := report || E'1. rent with no amount SAVED -- WRONG\n';
  exception when others then
    report := report || format('1. rent needs its amount (wants this): %s%s', sqlerrm, E'\n');
  end;

  v_card := public.save_bill(null, 'Check card', 'card', 9, 500, false, '2999-01-15'::date);
  select amount into v_amount from public.bills where id = v_card;
  report := report || format('2. an amount given for a card is dropped: %s (wants null)%s',
    coalesce(v_amount::text, 'null'), E'\n');

  v_rent := public.save_bill(null, 'Check rent', 'rent', 1, 1800, false, '2999-01-15'::date);

  ---------------------------------------------------------------- member
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_month := public.open_month('2999-01-01'::date, '2999-01-15'::date);
  select id, amount, entered_at into rent_row, v_amount, v_entered
    from public.month_bills where month_id = v_month and bill_id = v_rent;
  report := report || format('3. a month opens with rent filled in: $%s, entered: %s (wants 1800, t)%s',
    v_amount, v_entered is not null, E'\n');

  perform public.enter_bill(rent_row, 1850, null);
  insert into public.payments (month_bill_id, payer_id, amount) values (rent_row, member_id, 1700);
  report := report || E'4. member changes this month''s rent to $1,850 and pays $1,700 of it (wants this)\n';

  ---------------------------------------------------------------- admin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.save_bill(v_rent, 'Check rent', 'rent', 1, 2000, false, '2999-01-15'::date);
  select amount into v_amount from public.month_bills where id = rent_row;
  report := report || format('5. without the tick the open month keeps its rent: $%s (wants 1850)%s', v_amount, E'\n');

  perform public.save_bill(v_rent, 'Check rent renamed', 'rent', 1, 2000, true, '2999-01-15'::date);
  select amount into v_amount from public.month_bills where id = rent_row;
  report := report || format('6. a ticked save that leaves the amount alone keeps this month''s: $%s (wants 1850)%s', v_amount, E'\n');

  perform public.save_bill(v_rent, 'Check rent', 'rent', 1, 1900, true, '2999-01-15'::date);
  select amount into v_amount from public.month_bills where id = rent_row;
  report := report || format('7. with the tick a changed rent reaches the month: $%s (wants 1900)%s', v_amount, E'\n');

  begin
    perform public.save_bill(v_rent, 'Check rent', 'rent', 1, 1500, true, '2999-01-15'::date);
    report := report || E'8. rent LOWERED below what''s paid this month -- WRONG\n';
  exception when others then
    report := report || format('8. rent can''t drop below what''s paid this month (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
