-- Live check of Storage (REQ-87) and archiving paperwork files into it
-- (REQ-98), as a real household member, against the hosted project.
-- Needs one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/storage.sql
--
-- It writes invented entries and a file and ends by raising an error
-- carrying the results, which undoes every write. A rollback doesn't
-- give numbers back (paperwork.sql used up F-0001 to F-0004 that way), so
-- this puts the S- counter back where it found it before finishing. The
-- F- counter still moves on by one each run.
do $$
declare
  member_id uuid;
  report text := E'\n';
  v_count int;
  v_bool boolean;
  seq text := pg_get_serial_sequence('public.storage_entries', 'number');
  seq_last bigint;
  seq_called boolean;
  box uuid;
  loose uuid;
  box_number bigint;
  loose_number bigint;
  category uuid;
  a_file uuid;
begin
  execute format('select last_value, is_called from %s', seq) into seq_last, seq_called;

  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  if member_id is null then
    raise exception 'Need one member to test with';
  end if;

  -- A category for the test file, made as the owner of the database,
  -- since only an admin may add one.
  insert into public.paperwork_categories (name) values ('Check: storage') returning id into category;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Any member adds entries; each gets the next number.
  insert into public.storage_entries (name, is_box, contents) values ('Check: Shoes', true, E'Ski boots\nSandals')
    returning id, number into box, box_number;
  insert into public.storage_entries (name) values ('Check: Suitcases') returning id, number into loose, loose_number;
  report := report || format('1. a member adds two entries, numbered one after the other: %s (wants true)%s',
    loose_number = box_number + 1, E'\n');

  -- 2. A number can't be chosen or changed.
  begin
    update public.storage_entries set number = 999 where id = box;
    report := report || E'2. a number CHANGED -- WRONG\n';
  exception when others then
    report := report || format('2. changing a number is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 3. Something that isn't a box can't have contents.
  begin
    update public.storage_entries set contents = 'Socks' where id = loose;
    report := report || E'3. a loose item took contents -- WRONG\n';
  exception when others then
    report := report || format('3. contents on a loose item are refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 4. A file can't be archived into something that isn't a box.
  insert into public.paperwork_files (category_id, location) values (category, 'Check: desk') returning id into a_file;
  begin
    update public.paperwork_files set status = 'archived', storage_entry_id = loose where id = a_file;
    report := report || E'4. a file went into a loose item -- WRONG\n';
  exception when others then
    report := report || format('4. archiving into a loose item is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 5. Archived and "in a box" go together.
  begin
    update public.paperwork_files set status = 'archived' where id = a_file;
    report := report || E'5. archived with no box -- WRONG\n';
  exception when others then
    report := report || format('5. archived with no box is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 6. Into a box it goes.
  update public.paperwork_files set status = 'archived', storage_entry_id = box where id = a_file;
  select count(*) into v_count from public.paperwork_files where storage_entry_id = box and status = 'archived';
  report := report || format('6. a member archives a file into a box: %s (wants 1)%s', v_count, E'\n');

  -- 7. While it holds the file, the box stays a box and can't be removed.
  begin
    update public.storage_entries set is_box = false, contents = null where id = box;
    report := report || E'7a. a box holding a file stopped being a box -- WRONG\n';
  exception when others then
    report := report || format('7a. un-boxing a box holding a file is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    delete from public.storage_entries where id = box;
    report := report || E'7b. a box holding a file was REMOVED -- WRONG\n';
  exception when others then
    report := report || format('7b. removing a box holding a file is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 8. Brought back, the box is free to change or go.
  update public.paperwork_files set status = 'active', storage_entry_id = null, location = 'Check: study' where id = a_file;
  update public.storage_entries set is_box = false, contents = null where id = box;
  select not is_box into v_bool from public.storage_entries where id = box;
  report := report || format('8a. once the file is back, the box can stop being one: %s (wants true)%s', v_bool, E'\n');
  delete from public.storage_entries where id = box;
  get diagnostics v_count = row_count;
  report := report || format('8b. and can be removed: %s removed (wants 1)%s', v_count, E'\n');

  -- 9. Someone signed out sees none of it.
  reset role;
  set local role anon;
  begin
    select count(*) into v_count from public.storage_entries;
    report := report || format('9. signed out sees %s entries (wants refused or 0)%s', v_count, E'\n');
  exception when others then
    report := report || format('9. signed out is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  perform setval(seq, seq_last, seq_called);
  raise exception 'Results (all undone):%', report;
end;
$$;
