-- The admin console needs each member's name and email, which live in
-- Supabase's private auth.users table that the API never exposes. A
-- security-definer function reads them on the caller's behalf and returns
-- nothing at all unless the caller holds manage_members.

create function public.household_members_overview()
returns table (
  user_id uuid,
  name text,
  email text,
  role_id uuid,
  role_name text
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
    r.name as role_name
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  join public.roles r on r.id = hm.role_id
  where (select public.has_permission('manage_members'))
  order by r.name, u.email;
$$;

revoke all on function public.household_members_overview() from public;
grant execute on function public.household_members_overview() to authenticated, service_role;

-- Some roles must never be left empty: the household always needs an
-- admin. Like max_holders, the floor is data on the role, not a rule
-- about a role's name.
alter table public.roles
  add column min_holders integer
  check (min_holders is null or min_holders >= 0);

update public.roles set min_holders = 1 where name = 'Admin';

create function public.enforce_role_holder_minimum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  minimum integer;
  remaining integer;
begin
  if tg_op = 'UPDATE' and new.role_id = old.role_id then
    return new;
  end if;

  select min_holders into minimum
  from public.roles
  where id = old.role_id;

  if minimum is not null then
    select count(*) into remaining
    from public.household_members
    where household_id = old.household_id
      and role_id = old.role_id
      and user_id <> old.user_id;

    if remaining < minimum then
      raise exception 'This role must keep at least % holder(s)', minimum;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_role_holder_minimum() from public;

create trigger enforce_role_holder_minimum
  before update of role_id or delete on public.household_members
  for each row execute function public.enforce_role_holder_minimum();
