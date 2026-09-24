-- Live check of Paperwork (REQ-88, REQ-97), as real household members,
-- against the hosted project. Needs one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/paperwork.sql
--
-- It writes invented categories, files and paperwork and ends by raising
-- an error carrying the results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  v_count int;
  v_text text;
  taxes uuid;
  car uuid;
  first_file uuid;
  first_number bigint;
  second_number bigint;
  third_number bigint;
  paper uuid;
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

  -- 1. A member can't add a category.
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.paperwork_categories (name) values ('Check: member category');
    report := report || E'1. a member ADDED a category -- WRONG\n';
  exception when others then
    report := report || format('1. a member adding a category is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 1b. Nor change or remove one: those writes find no row they may touch.
  update public.paperwork_categories set name = name || ' (member)';
  get diagnostics v_count = row_count;
  report := report || format('1b. a member changing categories changed %s (wants 0)%s', v_count, E'\n');
  delete from public.paperwork_categories;
  get diagnostics v_count = row_count;
  report := report || format('1c. a member removing categories removed %s (wants 0)%s', v_count, E'\n');

  -- 2. The admin can, with an optional keep-for; the same name twice is refused.
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.paperwork_categories (name, keep_years) values ('Check: Taxes', 7) returning id into taxes;
  insert into public.paperwork_categories (name) values ('Check: Car') returning id into car;
  report := report || format('2a. the admin adds two categories: %s%s', taxes is not null and car is not null, E' (wants true)\n');
  begin
    insert into public.paperwork_categories (name) values ('  check: taxes ');
    report := report || E'2b. a second "taxes" SAVED -- WRONG\n';
  exception when others then
    report := report || format('2b. the same name twice is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 3. A member makes files; the numbers count up and can't be chosen or changed.
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.paperwork_files (category_id, location) values (taxes, 'Check: hall cupboard')
    returning id, number into first_file, first_number;
  insert into public.paperwork_files (category_id, location) values (car, 'Check: glovebox')
    returning number into second_number;
  report := report || format('3a. numbers count up: %s then %s (wants the second one more)%s', first_number, second_number, E'\n');
  begin
    insert into public.paperwork_files (number, category_id, location) values (1, taxes, 'Check: chosen number');
    report := report || E'3b. a chosen number SAVED -- WRONG\n';
  exception when others then
    report := report || format('3b. choosing a number is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    update public.paperwork_files set number = number + 1000 where id = first_file;
    report := report || E'3c. a number CHANGED -- WRONG\n';
  exception when others then
    report := report || format('3c. changing a number is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    insert into public.paperwork_files (category_id, location) values (taxes, '  ');
    report := report || E'3d. a blank location SAVED -- WRONG\n';
  exception when others then
    report := report || format('3d. a blank location is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 4. A removed file's number never comes back.
  delete from public.paperwork_files where number = second_number;
  insert into public.paperwork_files (category_id, location) values (car, 'Check: garage shelf')
    returning number into third_number;
  report := report || format('4. after removing %s the next is %s (wants more than %s)%s',
    second_number, third_number, second_number, E'\n');

  -- 5. Paperwork logged without a file is Unfiled; filing it moves it.
  insert into public.paperwork (name, owner_id) values ('Check: water bill notice', null) returning id into paper;
  select count(*) into v_count from public.paperwork where file_id is null and id = paper;
  report := report || format('5a. logged without a file is Unfiled: %s (wants 1)%s', v_count, E'\n');
  update public.paperwork set file_id = first_file, keep_until = '2033-09-24' where id = paper;
  select count(*) into v_count from public.paperwork where file_id = first_file;
  report := report || format('5b. filing puts it in the file: %s (wants 1)%s', v_count, E'\n');
  select logged_on::text into v_text from public.paperwork where id = paper;
  report := report || format('5c. logged on the household''s today: %s%s', v_text, E'\n');

  -- 6. A category in use can't be removed, even by the admin.
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    delete from public.paperwork_categories where id = taxes;
    report := report || E'6a. a category in use was REMOVED -- WRONG\n';
  exception when others then
    report := report || format('6a. removing a category in use is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  update public.paperwork_files set category_id = car where category_id = taxes;
  delete from public.paperwork_categories where id = taxes;
  select count(*) into v_count from public.paperwork_categories where id = taxes;
  report := report || format('6b. once its files move, it goes: %s left (wants 0)%s', v_count, E'\n');

  -- 7. Removing a file puts its paperwork back to Unfiled.
  delete from public.paperwork_files where id = first_file;
  select count(*) into v_count from public.paperwork where id = paper and file_id is null;
  report := report || format('7. removing its file makes it Unfiled again: %s (wants 1)%s', v_count, E'\n');

  -- 8. Someone signed out sees none of it.
  reset role;
  set local role anon;
  begin
    select count(*) into v_count from public.paperwork;
    report := report || format('8. signed out sees %s papers (wants refused or 0)%s', v_count, E'\n');
  exception when others then
    report := report || format('8. signed out is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
