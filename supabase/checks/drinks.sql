-- Live check of Drinks (REQ-37, REQ-29) as two real household members,
-- against the hosted project. Needs an Admin and a Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/drinks.sql
--
-- It writes an invented drink and ratings and ends by raising an error
-- carrying the results, which undoes every write.
do $$
declare
  admin_id uuid;
  member_id uuid;
  report text := E'\n';
  a_drink uuid;
  v_count int;
  v_text text;
  v_before timestamptz;
  v_after timestamptz;
begin
  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  select hm.user_id into admin_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Admin' order by hm.created_at limit 1;
  if member_id is null or admin_id is null then
    raise exception 'Need an Admin and a Member to test with';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A member adds a drink with only a name.
  insert into public.drinks (name) values ('Check: house red') returning id into a_drink;
  report := report || format('1. a member adds a drink with only a name: %s (wants true)%s', a_drink is not null, E'\n');

  -- 2. Both NV and a year is refused.
  begin
    insert into public.drinks (name, vintage, non_vintage) values ('Check: both', 2019, true);
    report := report || E'2. vintage and NV together SAVED -- WRONG\n';
  exception when others then
    report := report || format('2. vintage and NV together is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 3. The member rates it; rating again replaces, never adds.
  insert into public.drink_ratings (drink_id, stars, comment) values (a_drink, 3, 'fine');
  select updated_at into v_before from public.drink_ratings where drink_id = a_drink;
  insert into public.drink_ratings (drink_id, stars, comment) values (a_drink, 4, 'better second time')
    on conflict (drink_id, user_id) do update set stars = excluded.stars, comment = excluded.comment;
  select count(*), max(stars)::text into v_count, v_text from public.drink_ratings where drink_id = a_drink;
  report := report || format('3. rating again replaces it: %s row(s), %s stars (wants 1, 4)%s', v_count, v_text, E'\n');

  -- 4. Half stars, six stars and two-line comments are refused.
  begin
    update public.drink_ratings set stars = 6 where drink_id = a_drink;
    report := report || E'4. six stars SAVED -- WRONG\n';
  exception when others then
    report := report || format('4. six stars is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  begin
    update public.drink_ratings set comment = E'two\nlines' where drink_id = a_drink;
    report := report || E'5. a two-line comment SAVED -- WRONG\n';
  exception when others then
    report := report || format('5. a two-line comment is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 6. Rating for someone else is refused.
  begin
    insert into public.drink_ratings (drink_id, user_id, stars) values (a_drink, admin_id, 1);
    report := report || E'6. a rating for someone else SAVED -- WRONG\n';
  exception when others then
    report := report || format('6. rating for someone else is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 7. As the admin: sees the member's rating, can't change or remove it.
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.drink_ratings where drink_id = a_drink;
  report := report || format('7. the other person sees the rating: %s (wants 1)%s', v_count, E'\n');
  update public.drink_ratings set stars = 1 where drink_id = a_drink and user_id = member_id;
  delete from public.drink_ratings where drink_id = a_drink and user_id = member_id;
  select stars::text into v_text from public.drink_ratings where drink_id = a_drink and user_id = member_id;
  report := report || format('8. they can''t change or remove it: still %s stars (wants 4)%s', v_text, E'\n');

  -- 9. Removing the drink removes its ratings.
  delete from public.drinks where id = a_drink;
  reset role;
  select count(*) into v_count from public.drink_ratings where drink_id = a_drink;
  report := report || format('9. removing the drink removes its ratings: %s left (wants 0)%s', v_count, E'\n');

  raise exception 'Results (everything above was undone):%', report;
end;
$$;
