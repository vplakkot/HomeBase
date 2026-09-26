-- Live check of the label photos' bucket (REQ-32) against the hosted
-- project: private, and open only to household members. Needs one
-- Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/drink_photos.sql
--
-- It writes a pretend photo record and ends by raising an error carrying
-- the results, which undoes every write. (A row in storage.objects is
-- only the photo's record; no file is stored.)
do $$
declare
  member_id uuid;
  report text := E'\n';
  v_bool boolean;
  v_count int;
begin
  select public into v_bool from storage.buckets where id = 'drink-labels';
  report := report || format('1. the bucket is public: %s (wants false)%s', v_bool, E'\n');

  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  if member_id is null then
    raise exception 'Need one member to test with';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner) values ('drink-labels', 'check/1-front.jpg', member_id);
  select count(*) into v_count from storage.objects where bucket_id = 'drink-labels' and name = 'check/1-front.jpg';
  report := report || format('2. a member adds and sees a photo: %s (wants 1)%s', v_count, E'\n');

  -- 3. Signed in but not in the household: sees nothing, adds nothing.
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into v_count from storage.objects where bucket_id = 'drink-labels';
  report := report || format('3. someone outside the household sees: %s photos (wants 0)%s', v_count, E'\n');
  begin
    insert into storage.objects (bucket_id, name) values ('drink-labels', 'check/2-front.jpg');
    report := report || E'4. someone outside the household ADDED a photo -- WRONG\n';
  exception when others then
    report := report || format('4. someone outside the household can''t add one (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 5. Not signed in at all.
  reset role;
  set local role anon;
  select count(*) into v_count from storage.objects where bucket_id = 'drink-labels';
  report := report || format('5. a visitor who isn''t signed in sees: %s photos (wants 0)%s', v_count, E'\n');

  raise exception 'Results (everything above was undone):%', report;
end;
$$;
