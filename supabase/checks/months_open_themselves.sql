-- Live check of REQ-101 (a month opens itself) against the hosted
-- project. Needs a split in force and at least one bill in the list.
-- Run:
--
--   npx supabase db query --linked -f supabase/checks/months_open_themselves.sql
--
-- Like monthly_entry.sql it works in January 2999 (passing that as
-- "today") and ends by raising an error carrying the results, which
-- undoes every write.
do $$
declare
  report text := E'\n';
  member_id uuid;
  first_id uuid;
  second_id uuid;
  bill_count int;
  copied int;
  rent_ok boolean;
  cards_waiting boolean;
begin
  select count(*) into bill_count from public.bills;
  if bill_count = 0 then
    raise exception 'Need at least one bill in the list to test with';
  end if;

  -- 1. The job opens the month now running, copying every bill.
  first_id := public.open_current_month('2999-01-15'::date);
  select count(*) into copied from public.month_bills where month_id = first_id;
  report := report || format(E'1. job opened January 2999 with %s of %s bills -- %s\n',
    copied, bill_count, case when first_id is not null and copied = bill_count then 'ok' else 'WRONG' end);

  -- 2. Rent arrives with its amount and counts as entered.
  select coalesce(bool_and(amount is not null and entered_at is not null), true) into rent_ok
    from public.month_bills where month_id = first_id and kind = 'rent';
  report := report || format(E'2. rent pre-filled -- %s\n', case when rent_ok then 'ok' else 'WRONG' end);

  -- 3. Card statements wait for their amount.
  select coalesce(bool_and(amount is null and entered_at is null), true) into cards_waiting
    from public.month_bills where month_id = first_id and kind = 'card';
  report := report || format(E'3. card statements waiting -- %s\n', case when cards_waiting then 'ok' else 'WRONG' end);

  -- 4. Running again finds it open and copies nothing twice.
  second_id := public.open_current_month('2999-01-20'::date);
  select count(*) into copied from public.month_bills where month_id = first_id;
  report := report || format(E'4. second run same month, still %s bills -- %s\n',
    copied, case when second_id = first_id and copied = bill_count then 'ok' else 'WRONG' end);

  -- 5. A person opening the month the job already opened gets that month.
  select hm.user_id into member_id from public.household_members hm order by hm.created_at limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  second_id := public.open_month('2999-01-01'::date, '2999-01-15'::date);
  report := report || format(E'5. open_month returns the job''s month -- %s\n',
    case when second_id = first_id then 'ok' else 'WRONG' end);

  -- 6. Nobody signed in can run the job or its insides.
  begin
    perform public.open_current_month('2999-02-15'::date);
    report := report || E'6. member ran the job -- WRONG\n';
  exception when insufficient_privilege then
    report := report || E'6. member refused the job -- ok\n';
  end;
  begin
    perform public.create_month('2999-03-01'::date);
    report := report || E'7. member called create_month -- WRONG\n';
  exception when insufficient_privilege then
    report := report || E'7. member refused create_month -- ok\n';
  end;

  raise exception 'Results (rolled back):%', report;
end;
$$;
