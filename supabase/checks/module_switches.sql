-- Live check of the module switches (REQ-141 to REQ-143), as real
-- household members, against the hosted project. Needs one Admin and one
-- Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/module_switches.sql
--
-- It ends by raising an error carrying the results, which undoes every
-- write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  v_count integer;
  v_flag boolean;
  v_drinks integer := (select count(*) from public.drinks);
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

  select modules_chosen into v_flag from public.households limit 1;
  report := report || format('1. the household counts as chosen: %s (wants t)%s', v_flag, E'\n');

  ---------------------------------------------------------------- member
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.modules_off (module) values ('drinks');
    report := report || E'2. a member TURNED DRINKS OFF -- WRONG\n';
  exception when others then
    report := report || format('2. a member can''t turn a module off (wants this): %s%s', sqlerrm, E'\n');
  end;

  begin
    perform public.choose_modules(array['pets']);
    report := report || E'3. a member CHOSE MODULES -- WRONG\n';
  exception when others then
    report := report || format('3. a member can''t choose modules (wants this): %s%s', sqlerrm, E'\n');
  end;

  insert into public.modules_hidden (module) values ('drinks');
  select count(*) into v_count from public.modules_hidden;
  report := report || format('4. the member hides Drinks for themselves: %s row they can see (wants 1)%s', v_count, E'\n');

  ---------------------------------------------------------------- admin
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  select count(*) into v_count from public.modules_hidden;
  report := report || format('5. the admin sees none of the member''s hidden rows: %s (wants 0)%s', v_count, E'\n');

  delete from public.modules_hidden where user_id = member_id;
  reset role;
  select count(*) into v_count from public.modules_hidden where user_id = member_id;
  report := report || format('6. the admin can''t show it again for them: %s row left (wants 1)%s', v_count, E'\n');
  set local role authenticated;

  insert into public.modules_off (module) values ('drinks');
  select count(*) into v_count from public.modules_off where module = 'drinks';
  report := report || format('7. the admin turns Drinks off: %s row (wants 1)%s', v_count, E'\n');

  begin
    perform public.choose_modules(array['pets']);
    report := report || E'8. modules CHOSEN AGAIN -- WRONG\n';
  exception when others then
    report := report || format('8. modules are chosen only once (wants this): %s%s', sqlerrm, E'\n');
  end;

  delete from public.modules_off where module = 'drinks';
  reset role;
  select count(*) into v_count from public.modules_off where module = 'drinks';
  report := report || format('9. the admin turns it back on: %s rows; drinks kept %s of %s (wants 0, same)%s',
    v_count, (select count(*) from public.drinks), v_drinks, E'\n');

  raise exception 'Results (all undone):%', report;
end;
$$;
