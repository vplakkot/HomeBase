-- Live check of how we got a drink (REQ-35, REQ-36) and buy again
-- (REQ-34), as a real household member, against the hosted project.
-- Needs one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/drinks_how.sql
--
-- It ends by raising an error carrying the results, which undoes every
-- write.
do $$
declare
  member_id uuid;
  report text := E'\n';
  a_drink uuid;
  v_text text;
begin
  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  if member_id is null then
    raise exception 'Need one member to test with';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A drink must say how we got it.
  begin
    insert into public.drinks (name) values ('Check: no how');
    report := report || E'1. a drink without how SAVED -- WRONG\n';
  exception when others then
    report := report || format('1. a drink without how is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 2. A wish saves with the value alone, and can't be rated.
  insert into public.drinks (name, how) values ('Check: someday', 'want_to_try') returning id into a_drink;
  begin
    insert into public.drink_ratings (drink_id, stars) values (a_drink, 4);
    report := report || E'2. rating a want-to-try SAVED -- WRONG\n';
  exception when others then
    report := report || format('2. rating a want-to-try is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 3. A price on a wish is refused; changing to Bought with a price works.
  begin
    update public.drinks set price = '$40' where id = a_drink;
    report := report || E'3. a price on a want-to-try SAVED -- WRONG\n';
  exception when others then
    report := report || format('3. a price on a want-to-try is refused (wants this): %s%s', sqlerrm, E'\n');
  end;
  update public.drinks set how = 'bought', price = '$40', place = 'Check shop' where id = a_drink;
  select how || ' ' || price into v_text from public.drinks where id = a_drink;
  report := report || format('4. Want to try becomes Bought with a price: %s (wants bought $40)%s', v_text, E'\n');

  -- 5. Now it can be rated, with buy again.
  insert into public.drink_ratings (drink_id, stars, buy_again) values (a_drink, 3, true);
  select stars || ' ' || buy_again into v_text from public.drink_ratings where drink_id = a_drink;
  report := report || format('5. rated 3 stars, buy again yes: %s (wants 3 true)%s', v_text, E'\n');

  -- 6. Rated now, it can't go back to Want to try.
  begin
    update public.drinks set how = 'want_to_try', price = null, place = null where id = a_drink;
    report := report || E'6. a rated drink went back to want-to-try -- WRONG\n';
  exception when others then
    report := report || format('6. a rated drink going back to want-to-try is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  raise exception 'Results (everything above was undone):%', report;
end;
$$;
