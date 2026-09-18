-- After the first sign-up, the only way into the household is an account
-- an admin created. Such accounts carry app_metadata that only the
-- server-side key can write (self sign-ups cannot set app_metadata), so
-- the trigger can tell the two apart and keep refusing self sign-ups.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_household_id uuid;
  new_household_id uuid;
  role_to_grant uuid;
  requested_role text;
begin
  select id into existing_household_id from public.households limit 1;

  if existing_household_id is null then
    insert into public.households default values
    returning id into new_household_id;

    select id into role_to_grant from public.roles where name = 'Admin';

    insert into public.household_members (user_id, household_id, role_id)
    values (new.id, new_household_id, role_to_grant);

    return new;
  end if;

  if coalesce(new.raw_app_meta_data->>'created_by_admin', '') <> 'true' then
    raise exception 'Sign-up is closed: the household already exists';
  end if;

  -- The role an admin-created account starts with; Member unless the
  -- admin chose otherwise. The name is data here, not a rule.
  requested_role := coalesce(new.raw_app_meta_data->>'household_role', 'Member');

  select id into role_to_grant from public.roles where name = requested_role;
  if role_to_grant is null then
    raise exception 'Unknown role: %', requested_role;
  end if;

  insert into public.household_members (user_id, household_id, role_id)
  values (new.id, existing_household_id, role_to_grant);

  return new;
end;
$$;
