-- Live check of Restaurants (REQ-90, REQ-129, REQ-131 to REQ-133), as a real household
-- member, against the hosted project. Needs one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/restaurants.sql
--
-- It writes invented places and ends by raising an error carrying the
-- results, which undoes every write.
do $$
declare
  member_id uuid;
  other_id uuid;
  report text := E'\n';
  v_count int;
  v_by uuid;
  saved uuid;
begin
  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  select user_id into other_id from public.household_members where user_id <> member_id limit 1;
  if member_id is null or other_id is null then
    raise exception 'Need a member and one other person to test with';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A member adds a place; who and when are filled in.
  insert into public.restaurants (google_place_id) values ('ChIJCheckInvented0001') returning id, added_by into saved, v_by;
  report := report || format('1. a member adds a place, marked as theirs: %s (wants true)%s', v_by = member_id, E'\n');

  -- 2. The same place can't be saved twice.
  begin
    insert into public.restaurants (google_place_id) values ('ChIJCheckInvented0001');
    report := report || E'2. a duplicate was SAVED -- WRONG\n';
  exception when others then
    report := report || format('2. a duplicate is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 3. Nobody can add a place in someone else's name.
  begin
    insert into public.restaurants (google_place_id, added_by) values ('ChIJCheckInvented0002', other_id);
    report := report || E'3. a place was added in someone else''s name -- WRONG\n';
  exception when others then
    report := report || format('3. adding in someone else''s name is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 4. Only a place ID's shape is accepted.
  begin
    insert into public.restaurants (google_place_id) values ('not a place id');
    report := report || E'4. a malformed place ID was SAVED -- WRONG\n';
  exception when others then
    report := report || format('4. a malformed place ID is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 5. Which place a row is never changes (only its booking link and
  -- tried date do, below).
  begin
    update public.restaurants set google_place_id = 'ChIJCheckInvented0003' where id = saved;
    get diagnostics v_count = row_count;
    report := report || format('5. changing which place a row is touched %s rows (wants refused or 0)%s', v_count, E'\n');
  exception when others then
    report := report || format('5. changing which place a row is, refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 6. A member sets a booking link (REQ-132) and marks the place tried
  -- (REQ-133).
  update public.restaurants set booking_url = 'https://www.opentable.com/r/check-invented', tried_on = current_date where id = saved;
  get diagnostics v_count = row_count;
  report := report || format('6. a member sets the booking link and tried date: %s row (wants 1)%s', v_count, E'\n');

  -- 7. A booking link must be a web address.
  begin
    update public.restaurants set booking_url = 'javascript:alert(1)' where id = saved;
    report := report || E'7. a non-web booking link was SAVED -- WRONG\n';
  exception when others then
    report := report || format('7. a non-web booking link is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 8. The member answers for themselves, and can change it.
  insert into public.restaurant_answers (restaurant_id, go_again) values (saved, true);
  update public.restaurant_answers set go_again = false where restaurant_id = saved and user_id = member_id;
  get diagnostics v_count = row_count;
  report := report || format('8. a member answers, then changes their answer: %s row (wants 1)%s', v_count, E'\n');

  -- 9. Nobody answers in someone else's name.
  begin
    insert into public.restaurant_answers (restaurant_id, user_id, go_again) values (saved, other_id, true);
    report := report || E'9. an answer was saved in someone else''s name -- WRONG\n';
  exception when others then
    report := report || format('9. answering for someone else is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 10. Nobody changes the other person's answer. The other's answer is
  -- written as the database owner, as if they had given it.
  reset role;
  insert into public.restaurant_answers (restaurant_id, user_id, go_again) values (saved, other_id, true);
  set local role authenticated;
  update public.restaurant_answers set go_again = false where restaurant_id = saved and user_id = other_id;
  get diagnostics v_count = row_count;
  report := report || format('10. changing the other person''s answer touched %s rows (wants 0)%s', v_count, E'\n');
  delete from public.restaurant_answers where restaurant_id = saved and user_id = other_id;
  get diagnostics v_count = row_count;
  report := report || format('11. deleting the other person''s answer touched %s rows (wants 0)%s', v_count, E'\n');

  -- 12. Undoing tried clears both answers (REQ-133).
  update public.restaurants set tried_on = null where id = saved;
  reset role;
  select count(*) into v_count from public.restaurant_answers where restaurant_id = saved;
  report := report || format('12. undoing tried leaves %s answers (wants 0)%s', v_count, E'\n');
  set local role authenticated;

  -- 13. No answering for a place not tried.
  begin
    insert into public.restaurant_answers (restaurant_id, go_again) values (saved, true);
    report := report || E'13. an answer was saved for a place not tried -- WRONG\n';
  exception when others then
    report := report || format('13. answering before it''s tried is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 14. A member removes a place.
  delete from public.restaurants where id = saved;
  get diagnostics v_count = row_count;
  report := report || format('14. a member removes a place: %s row (wants 1)%s', v_count, E'\n');

  -- 15. Someone signed out sees none of it.
  reset role;
  insert into public.restaurants (google_place_id, added_by) values ('ChIJCheckInvented0004', member_id);
  set local role anon;
  begin
    select count(*) into v_count from public.restaurants;
    report := report || format('15. signed out sees %s places (wants refused or 0)%s', v_count, E'\n');
  exception when others then
    report := report || format('15. signed out is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'Results (all undone):%', report;
end;
$$;
