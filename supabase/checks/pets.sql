-- Live check of Pets (REQ-186 to REQ-189) against the hosted project: a
-- member can keep a pet's records, someone outside the household sees
-- nothing, the photo bucket is private, and the database's own rules
-- hold (one current diet per pet, a vaccine isn't due before it was
-- given, a home-cooked diet names its protein). Needs one Member. Run:
--
--   npx supabase db query --linked -f supabase/checks/pets.sql
--
-- It writes pretend records and ends by raising an error carrying the
-- results, which undoes every write.
do $$
declare
  member_id uuid;
  pet_id uuid := gen_random_uuid();
  med_id uuid := gen_random_uuid();
  report text := E'\n';
  v_bool boolean;
  v_count int;
begin
  select public into v_bool from storage.buckets where id = 'pet-photos';
  report := report || format('1. the photo bucket is public: %s (wants false)%s', v_bool, E'\n');

  select hm.user_id into member_id
    from public.household_members hm join public.roles r on r.id = hm.role_id
   where r.name = 'Member' order by hm.created_at limit 1;
  if member_id is null then
    raise exception 'Need one member to test with';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.pets (id, name, species) values (pet_id, 'Check Pet', 'Dog');
  insert into public.pet_vaccines (pet_id, name, given_on, next_due_on) values (pet_id, 'Rabies', '2026-10-01', '2027-10-01');
  insert into public.pet_diets (pet_id, kind, brand, product, grams_per_meal, meals_per_day, started_on)
    values (pet_id, 'commercial', 'Acme', 'Salmon', 120, 2, '2026-10-01');
  insert into public.pet_medications (id, name, frequency, starts_on) values (med_id, 'Chewable', 'monthly', '2026-10-01');
  insert into public.pet_medication_pets (medication_id, pet_id, next_dose_on) values (med_id, pet_id, '2026-10-01');
  insert into public.pet_doses (medication_id, pet_id, given_on) values (med_id, pet_id, '2026-10-01');
  select count(*) into v_count from public.pets where id = pet_id;
  report := report || format('2. a member adds and sees a pet and its records: %s pet (wants 1)%s', v_count, E'\n');

  begin
    insert into public.pet_diets (pet_id, kind, brand, product, grams_per_meal, meals_per_day, started_on)
      values (pet_id, 'commercial', 'Other', 'Beef', 100, 2, '2026-10-02');
    report := report || E'3. a second current diet was ADDED -- WRONG\n';
  exception when unique_violation then
    report := report || E'3. a pet can''t have two current diets (wants this)\n';
  end;

  begin
    insert into public.pet_vaccines (pet_id, name, given_on, next_due_on) values (pet_id, 'Lepto', '2026-10-01', '2026-09-01');
    report := report || E'4. a vaccine due before it was given was ADDED -- WRONG\n';
  exception when check_violation then
    report := report || E'4. a vaccine can''t be due before it was given (wants this)\n';
  end;

  begin
    insert into public.pet_diets (pet_id, kind, grams_per_meal, meals_per_day, started_on, ended_on)
      values (pet_id, 'home_cooked', 100, 2, '2026-01-01', '2026-02-01');
    report := report || E'5. a home-cooked diet with no protein was ADDED -- WRONG\n';
  exception when check_violation then
    report := report || E'5. a home-cooked diet needs its protein (wants this)\n';
  end;

  -- 6. Signed in but not in the household: sees nothing, adds nothing.
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.pets;
  report := report || format('6. someone outside the household sees: %s pets (wants 0)%s', v_count, E'\n');
  begin
    insert into public.pets (name, species) values ('Intruder', 'Cat');
    report := report || E'7. someone outside the household ADDED a pet -- WRONG\n';
  exception when others then
    report := report || format('7. someone outside the household can''t add one (wants this): %s%s', sqlerrm, E'\n');
  end;

  -- 8. Not signed in at all.
  reset role;
  set local role anon;
  begin
    select count(*) into v_count from public.pets;
    report := report || format('8. a visitor who isn''t signed in sees: %s pets (wants 0 or a refusal)%s', v_count, E'\n');
  exception when others then
    report := report || format('8. a visitor who isn''t signed in is refused (wants this): %s%s', sqlerrm, E'\n');
  end;

  raise exception 'Results (everything above was undone):%', report;
end;
$$;
