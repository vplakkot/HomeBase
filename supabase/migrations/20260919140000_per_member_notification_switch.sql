-- REQ-16. Whether a member receives notifications is one flag on their
-- membership, off until an admin turns it on. The default is what makes
-- "a new member starts switched off" true everywhere, for the first admin
-- and for every invited member, without either insert mentioning it.

alter table public.household_members
  add column notifications_enabled boolean not null default false;

-- Row-level security decides which ROWS you may read. This flag needs the
-- column-level equivalent: members may read each other's membership rows,
-- but only someone with manage_members may learn who has notifications on.
--
-- A column-level revoke is ignored while a table-level grant is in force,
-- so the table-level SELECT has to go first and be replaced by a list of
-- the columns members may still read. service_role keeps full access, and
-- so does the table's owner, which is what the security definer function
-- below runs as.
revoke select on public.household_members from authenticated;
grant select (user_id, household_id, role_id, created_at)
  on public.household_members to authenticated;

-- The admin console's roster now has to carry the flag too. A function
-- that returns a table can't be replaced with one returning a different
-- set of columns, so this drops it and creates it again rather than using
-- create or replace.
drop function public.household_members_overview();

create function public.household_members_overview()
returns table (
  user_id uuid,
  name text,
  email text,
  role_id uuid,
  role_name text,
  notifications_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    hm.user_id,
    u.raw_user_meta_data->>'name' as name,
    u.email::text as email,
    hm.role_id,
    r.name as role_name,
    hm.notifications_enabled
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  join public.roles r on r.id = hm.role_id
  where (select public.has_permission('manage_members'))
  order by r.name, u.email;
$$;

revoke all on function public.household_members_overview() from public;
grant execute on function public.household_members_overview() to authenticated, service_role;

-- A consequence to hand forward: after this, the ONLY way to read the flag
-- is this function, and it requires manage_members. A background job has no
-- signed-in user, so when REQ-21 sends notifications it cannot use this
-- route. It will need its own — running as service_role, or a second
-- security definer function written for a caller that is nobody. Deciding
-- that here would mean guessing how that job authenticates, so it is left
-- to the requirement that knows.
