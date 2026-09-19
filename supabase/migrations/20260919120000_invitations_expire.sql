-- An invitation is written a moment before the account it admits, and the
-- sign-up trigger uses it up. If the server dies between those two steps the
-- row is left behind: the admin's retry is told the email is already waiting,
-- and worse, that address can walk in through the public sign-up form at any
-- time afterwards. A short life makes the leftover harmless — ten minutes is
-- far longer than the create it covers, and after that it admits nobody.

alter table public.member_invitations
  add column expires_at timestamptz not null default (now() + interval '10 minutes');

-- Rows written before this migration existed would take that default and come
-- out of it with a fresh ten minutes — re-arming the very leftovers the column
-- is here to disarm. Date them from when they were actually created instead,
-- so anything already stale is already expired the moment this lands.
update public.member_invitations
  set expires_at = created_at + interval '10 minutes';

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

  -- Best-effort tidying, not the guard: this runs inside the sign-up's
  -- transaction, so it only survives if the sign-up itself succeeds. A
  -- refused sign-up rolls it back and the dead row stays until an admin
  -- next adds a member, which sweeps in a transaction of its own. What
  -- makes a dead row harmless is the expires_at test below, not this.
  delete from public.member_invitations where expires_at <= now();

  select * into invitation
  from public.member_invitations
  where email = lower(new.email)
    and expires_at > now();

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

revoke all on function public.handle_new_user() from public;
