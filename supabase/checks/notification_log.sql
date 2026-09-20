-- Live check of notification_log's rules (REQ-22), as real household
-- members, against the hosted project. Needs at least one Admin and one
-- Member. Run it with:
--
--   npx supabase db query --linked -f supabase/checks/notification_log.sql
--
-- Why this exists. Every test of the log mocks Supabase, and every live
-- check of the sender ran with the secret key — which bypasses row-level
-- security entirely. So nothing had actually proven that a signed-in
-- admin can read this table, or that a member cannot. A policy that
-- silently denies everyone looks exactly like an empty log.
--
-- It never signs in as anyone. It sets the database's own idea of who is
-- asking (request.jwt.claims) and switches to the role a signed-in person
-- has, so the table's rules treat it exactly as they would that person.
-- It ends by raising an error carrying the results, which makes Postgres
-- undo every write: nothing is left behind.
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

  -- Two rows to look at, written as the owner of the table (this block
  -- runs before any role switch), one for each person.
  insert into public.notification_log (trigger, user_id, device, receipt_hash)
  values ('manual', admin_id, 'checkadmin00', 'hash-check-admin'),
         ('manual', member_id, 'checkmember0', 'hash-check-member');

  ---------------------------------------------------------------- admin
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.notification_log;
  report := report || format(
    '1. admin reads the log: sees %s of 2 rows (wants 2)%s', n, E'\n');

  begin
    insert into public.notification_log (trigger, user_id, device, receipt_hash)
    values ('manual', admin_id, 'forged000000', 'hash-forged');
    report := report || E'2. admin INSERTED a row -- WRONG, nobody may write\n';
  exception when others then
    report := report || E'2. admin cannot insert a row (wants this)\n';
  end;

  -- The whole point of storing a hash: even the one person who can read
  -- the table cannot turn what they read into a delivery report.
  begin
    update public.notification_log set delivered_at = now()
     where device = 'checkmember0';
    get diagnostics n = row_count;
    report := report || format(
      '3. admin marked %s rows delivered (wants 0)%s', n, E'\n');
  exception when others then
    report := report || E'3. admin cannot mark a row delivered (wants this)\n';
  end;

  --------------------------------------------------------------- member
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.notification_log;
  report := report || format(
    '4. member reads the log: sees %s rows (wants 0, including their own)%s',
    n, E'\n');

  reset role;
  raise exception 'RESULTS (all undone):%', report;
end $$;
