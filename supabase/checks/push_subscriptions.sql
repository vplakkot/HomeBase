-- Live check of push_subscriptions' rules (REQ-20), as real household
-- members, against the hosted project. Needs at least one Admin and one
-- Member in the household. Run it with:
--
--   npx supabase db query --linked -f supabase/checks/push_subscriptions.sql
--
-- It never signs in as anyone. It sets the database's own idea of who is
-- asking (request.jwt.claims) and switches to the role a signed-in person
-- has, so the table's rules treat it exactly as they would that person.
-- It ends by raising an error that carries the results, which makes
-- Postgres undo every write: nothing is left behind. Read the numbered
-- lines in the error message; each says what it wants.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  n int;
  m1 constant text := 'https://web.push.apple.com/verify-req20-member-phone';
  m2 constant text := 'https://web.push.apple.com/verify-req20-member-ipad';
  a1 constant text := 'https://web.push.apple.com/verify-req20-admin-phone';
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
  select count(*) into n from public.push_subscriptions;
  report := report || format('0. rows before the test (ground truth): %s', n) || E'\n';

  ---------------------------------------------------------------- the member
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.push_subscriptions (endpoint, p256dh, auth) values (m1, 'k1', 'a1');
  insert into public.push_subscriptions (endpoint, p256dh, auth) values (m2, 'k2', 'a2');
  select count(*) into n from public.push_subscriptions where user_id = member_id;
  report := report || format('1. member saves a phone and an iPad; rows filed under the member: %s (want 2)', n) || E'\n';

  insert into public.push_subscriptions (endpoint, p256dh, auth) values (m1, 'k1-new', 'a1-new')
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
  select count(*) into n from public.push_subscriptions;
  report := report || format('2. member re-saves the phone; rows the member can see: %s (want 2, refreshed not duplicated)', n) || E'\n';

  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
      values (admin_id, 'https://web.push.apple.com/verify-req20-forged', 'k', 'a');
    report := report || '3. member saves a device under the admin: ALLOWED (bad)' || E'\n';
  exception when others then
    report := report || format('3. member saves a device under the admin: refused (%s)', sqlerrm) || E'\n';
  end;

  begin
    insert into public.push_subscriptions (endpoint, p256dh, auth)
      values ('https://example.com/not-a-push-service', 'k', 'a');
    report := report || '4. member saves a non-push-service address: ALLOWED (bad)' || E'\n';
  exception when others then
    report := report || format('4. member saves a non-push-service address: refused (%s)', sqlerrm) || E'\n';
  end;

  ----------------------------------------------------------------- the admin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.push_subscriptions (endpoint, p256dh, auth) values (a1, 'k3', 'a3');
  select count(*) into n from public.push_subscriptions;
  report := report || format('5. admin saves a phone; rows the admin can see: %s (want 1, only their own)', n) || E'\n';

  update public.push_subscriptions set p256dh = 'hijacked' where endpoint = m1;
  get diagnostics n = row_count;
  report := report || format('6. admin changes the member''s phone: rows changed %s (want 0)', n) || E'\n';

  delete from public.push_subscriptions where endpoint = m2;
  get diagnostics n = row_count;
  report := report || format('7. admin removes the member''s iPad: rows removed %s (want 0)', n) || E'\n';

  begin
    insert into public.push_subscriptions (endpoint, p256dh, auth) values (m1, 'x', 'y')
      on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
    report := report || '8. admin takes over the member''s phone by re-saving it: ALLOWED (bad)' || E'\n';
  exception when others then
    report := report || format('8. admin takes over the member''s phone by re-saving it: refused (%s)', sqlerrm) || E'\n';
  end;

  ---------------------------------------------------------- back to member
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  delete from public.push_subscriptions where endpoint = m2;
  get diagnostics n = row_count;
  report := report || format('9. member removes their own iPad: rows removed %s (want 1)', n) || E'\n';

  ------------------------------------------------------------- signed out
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    select count(*) into n from public.push_subscriptions;
    report := report || format('10. signed-out visitor reads the table: ALLOWED, %s rows (bad)', n) || E'\n';
  exception when others then
    report := report || format('10. signed-out visitor reads the table: refused (%s)', sqlerrm) || E'\n';
  end;
  reset role;

  ------------------------------------------------------------ ground truth
  select count(*) into n from public.push_subscriptions where endpoint like '%verify-req20%';
  report := report || format('11. ground truth: test rows present %s (want 2: member phone, admin phone)', n) || E'\n';
  select count(*) into n from public.push_subscriptions where endpoint = m1 and p256dh = 'k1-new';
  report := report || format('12. ground truth: member phone still has its own refreshed keys: %s (want 1)', n) || E'\n';

  raise exception 'RESULTS (all undone):%', report;
end
$$;
