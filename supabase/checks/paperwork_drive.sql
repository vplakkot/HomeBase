-- Live check of Paperwork's Google Drive rules (REQ-152), as real household
-- members, against the hosted project. Needs one Admin and one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/paperwork_drive.sql
--
-- It writes invented rows and ends by raising an error carrying the
-- results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  v_count int;
  drive_place uuid;
  taxes uuid;
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

  select id into drive_place from public.paperwork_locations where built_in = 'drive';
  report := report || format('0. the built-in Drive location exists: %s (wants true)%s', drive_place is not null, E'\n');

  -- 1. The admin connects the folder; a member can't, nor change it.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.paperwork_drive (folder_id, archived_folder_id) values ('check-top', 'check-arch');
  insert into public.paperwork_categories (name) values ('Check: Drive taxes') returning id into taxes;
  report := report || E'1a. the admin connects a folder (wants no error)\n';

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.paperwork_drive set folder_id = 'check-other';
    get diagnostics v_count = row_count;
    report := report || format('1b. a member changing the connection changed %s (wants 0)%s', v_count, E'\n');
  exception when others then
    report := report || format('1b. refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  select count(*) into v_count from public.paperwork_drive;
  report := report || format('1c. a member reads the connection: %s (wants 1)%s', v_count, E'\n');

  -- 2. A member syncs: makes a Drive file, records folders and documents, stamps the time.
  insert into public.paperwork_files (category_id, location_id, is_drive) values (taxes, drive_place, true);
  insert into public.paperwork_drive_folders (drive_id, name) values ('check-folder', 'F-9999_Check');
  insert into public.paperwork_drive_documents (drive_id, name, parent_id) values ('check-doc', 'Check.pdf', 'check-folder');
  perform public.record_drive_sync();
  select count(*) into v_count from public.paperwork_drive where synced_at is not null;
  report := report || format('2. a member makes a Drive file, records a folder and document and stamps the sync: %s stamped (wants 1)%s', v_count, E'\n');

  -- 3. A member can't remove a document's record; the admin can.
  delete from public.paperwork_drive_documents where drive_id = 'check-doc';
  get diagnostics v_count = row_count;
  report := report || format('3a. a member removing a document record removed %s (wants 0)%s', v_count, E'\n');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.paperwork_drive_documents where drive_id = 'check-doc';
  get diagnostics v_count = row_count;
  report := report || format('3b. the admin removing it removed %s (wants 1)%s', v_count, E'\n');

  -- 4. The built-in location can't be renamed or removed, even by the admin.
  begin
    update public.paperwork_locations set name = 'Cloud' where id = drive_place;
    report := report || E'4a. the Drive location was RENAMED -- WRONG\n';
  exception when others then
    report := report || format('4a. renaming it is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    delete from public.paperwork_locations where id = drive_place;
    report := report || E'4b. the Drive location was REMOVED -- WRONG\n';
  exception when others then
    report := report || format('4b. removing it is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 5. Signed out sees none of it.
  reset role;
  set local role anon;
  begin
    select count(*) into v_count from public.paperwork_drive_documents;
    report := report || format('5. signed out sees %s documents (wants refused or 0)%s', v_count, E'\n');
  exception when others then
    report := report || format('5. signed out is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
