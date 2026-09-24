-- Live check of what Finances action items and reminders store (REQ-91,
-- REQ-93, REQ-70), as real household members, against the hosted project.
-- Needs one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/action_items.sql
--
-- It opens a month for January 2999 and ends by raising an error carrying
-- the results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  v_month uuid;
  v_bill uuid;
  report text := E'\n';
  v_count int;
  v_who uuid;
  v_url text;
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

  insert into public.months (starts_on) values ('2999-01-01') returning id into v_month;
  insert into public.month_bills (month_id, name, kind, due_day)
  values (v_month, 'Test bill', 'other', 5) returning id into v_bill;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Entering a bill records who entered it.
  perform public.enter_bill(v_bill, 120, null);
  select entered_by into v_who from public.month_bills where id = v_bill;
  report := report || format('1. entering records who: %s (wants the member)%s',
    case when v_who = member_id then 'the member' else coalesce(v_who::text, 'nobody') end, E'\n');

  -- 2. A person acknowledges an item for themselves, twice without harm.
  insert into public.action_item_acks (key) values ('ready:2999-01-01') on conflict do nothing;
  insert into public.action_item_acks (key) values ('ready:2999-01-01') on conflict do nothing;
  select count(*) into v_count from public.action_item_acks where key = 'ready:2999-01-01';
  report := report || format('2. the member acknowledges, twice: %s row (wants 1)%s', v_count, E'\n');

  -- 3. Nobody acknowledges for someone else.
  begin
    insert into public.action_item_acks (user_id, key) values (admin_id, 'cash-gap:2999-01-01');
    report := report || E'3. acknowledging for the admin SAVED -- WRONG\n';
  exception when others then
    report := report || format('3. acknowledging for someone else is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 4. Nobody reads someone else's acknowledgements.
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.action_item_acks where key = 'ready:2999-01-01';
  report := report || format('4. the admin sees the member''s: %s rows (wants 0)%s', v_count, E'\n');

  -- 5. Signed-in people can't read or write the pushes sent.
  begin
    select count(*) into v_count from public.finance_pushes;
    report := report || format('5a. reading pushes sent gave %s rows -- WRONG, wants refused%s', v_count, E'\n');
  exception when others then
    report := report || format('5a. reading pushes sent is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    insert into public.finance_pushes (user_id, topic) values (admin_id, 'enter:2999-01-01');
    report := report || E'5b. writing a push sent SAVED -- WRONG\n';
  exception when others then
    report := report || format('5b. writing a push sent is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;

  -- 6. The job's claim: the second of two identical claims inserts nothing.
  insert into public.finance_pushes (user_id, topic) values (admin_id, 'enter:2999-01-01') on conflict do nothing;
  insert into public.finance_pushes (user_id, topic) values (admin_id, 'enter:2999-01-01') on conflict do nothing;
  select count(*) into v_count from public.finance_pushes where topic = 'enter:2999-01-01';
  report := report || format('6. a push claimed twice: %s row (wants 1)%s', v_count, E'\n');

  -- 7. The log takes Finances pushes.
  insert into public.notification_log (trigger, user_id, device, receipt_hash)
  values ('finances', admin_id, 'check', 'check-' || gen_random_uuid());
  report := report || E'7. the log takes a Finances push (wants this line)\n';

  -- 8. The hourly job is scheduled, and calls the Finances address on the
  --    same server as the test notification. Only the path is shown.
  select count(*) into v_count from cron.job where jobname = 'finance-reminders';
  select regexp_replace(
           regexp_replace(decrypted_secret, '^(https?://[^/]+).*$', '\1') || '/api/notifications/finances',
           '^https?://[^/]+', '')
    into v_url from vault.decrypted_secrets where name = 'notify_url';
  report := report || format('8. job scheduled: %s (wants 1), calling %s (wants /api/notifications/finances)%s',
    v_count, coalesce(v_url, 'nothing: no notify_url'), E'\n');

  raise exception 'Results (all undone):%', report;
end;
$$;
