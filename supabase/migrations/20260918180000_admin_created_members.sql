-- After the first sign-up, the only way into the household is an account
-- an admin has invited by email. The signal has to exist BEFORE the user
-- row does: Supabase's admin API inserts the row first and applies
-- app_metadata afterwards, so an AFTER INSERT trigger can't rely on a
-- flag there. An invitation row written beforehand is what the trigger
-- checks; only someone holding manage_members can write one.

create table public.member_invitations (
  email text primary key check (email = lower(email)),
  role_id uuid references public.roles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.member_invitations enable row level security;

create policy "manage invitations"
  on public.member_invitations for all to authenticated
  using ((select public.has_permission('manage_members')))
  with check ((select public.has_permission('manage_members')));

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
  invitation public.member_invitations%rowtype;
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

  select * into invitation
  from public.member_invitations
  where email = lower(new.email);

  if not found then
    raise exception 'Sign-up is closed: the household already exists';
  end if;

  role_to_grant := invitation.role_id;
  if role_to_grant is null then
    -- Member unless the admin chose a role. The name is data here, not a rule.
    select id into role_to_grant from public.roles where name = 'Member';
  end if;

  insert into public.household_members (user_id, household_id, role_id)
  values (new.id, existing_household_id, role_to_grant);

  delete from public.member_invitations where email = invitation.email;

  return new;
end;
$$;
