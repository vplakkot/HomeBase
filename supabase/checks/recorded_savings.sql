-- Live check of recorded savings (REQ-66), as a real household member,
-- against the hosted project. Needs one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/recorded_savings.sql
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
  v_joint numeric;
  v_own numeric;
  v_count int;
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

  v_month := public.open_month('2999-01-01'::date, '2999-01-15'::date);

  -- 1. A member records savings for both people, the way the page does.
  insert into public.month_savings (month_id, user_id, to_joint, own)
  values (v_month, member_id, 100, 0), (v_month, admin_id, 100, 1200)
  on conflict (month_id, user_id) do update set to_joint = excluded.to_joint, own = excluded.own;
  select count(*) into v_count from public.month_savings where month_id = v_month;
  report := report || format('1. a member records both people: %s rows (wants 2)%s', v_count, E'\n');

  -- 2. Saving again corrects rather than adds.
  insert into public.month_savings (month_id, user_id, to_joint, own)
  values (v_month, member_id, 60, 5)
  on conflict (month_id, user_id) do update set to_joint = excluded.to_joint, own = excluded.own;
  select to_joint, own into v_joint, v_own from public.month_savings
   where month_id = v_month and user_id = member_id;
  report := report || format('2. saving again corrects it: %s / %s (wants 60.00 / 5.00)%s', v_joint, v_own, E'\n');

  -- 3. A negative amount is refused.
  begin
    update public.month_savings set own = -1 where month_id = v_month and user_id = member_id;
    report := report || E'3. a negative amount SAVED -- WRONG\n';
  exception when others then
    report := report || format('3. a negative amount is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 4. Once the month is closed, savings can still be corrected.
  reset role;
  update public.months set closed_at = now() where id = v_month;
  set local role authenticated;
  update public.month_savings set to_joint = 100 where month_id = v_month and user_id = member_id;
  select to_joint into v_joint from public.month_savings where month_id = v_month and user_id = member_id;
  report := report || format('4. a closed month''s savings can be corrected: %s (wants 100.00)%s', v_joint, E'\n');

  -- 5. And the record can be removed entirely, even closed.
  delete from public.month_savings where month_id = v_month;
  select count(*) into v_count from public.month_savings where month_id = v_month;
  report := report || format('5. a closed month''s record can be removed: %s rows left (wants 0)%s', v_count, E'\n');

  -- 6. Someone signed out sees none of it.
  reset role;
  set local role anon;
  begin
    select count(*) into v_count from public.month_savings;
    report := report || format('6. signed out sees %s rows (wants refused or 0)%s', v_count, E'\n');
  exception when others then
    report := report || format('6. signed out is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
