-- Permissions are rows hanging off roles, and every access rule below asks
-- for a permission, never for a role's name. A future role is new rows in
-- roles + role_permissions; no policy changes.

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);

alter table public.role_permissions enable row level security;

-- Seed. The only place a role is picked by name is when handing out its
-- keys here; the rules below never do.
insert into public.role_permissions (role_id, permission)
select r.id, seed.permission
from public.roles r
join (
  values
    ('Admin', 'use_modules'),
    ('Admin', 'manage_members'),
    ('Admin', 'manage_roles'),
    ('Member', 'use_modules')
) as seed (role, permission) on seed.role = r.name;

-- How many people may hold a role at once; null means no limit.
alter table public.roles
  add column max_holders integer
  check (max_holders is null or max_holders > 0);

update public.roles set max_holders = 2 where name = 'Admin';

-- Does the caller belong to the household?
create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where user_id = (select auth.uid())
  );
$$;

-- Does the caller's role carry this permission?
create function public.has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    join public.role_permissions rp on rp.role_id = hm.role_id
    where hm.user_id = (select auth.uid())
      and rp.permission = has_permission.permission
  );
$$;

revoke all on function public.is_member() from public;
revoke all on function public.has_permission(text) from public;
grant execute on function public.is_member() to anon, authenticated, service_role;
grant execute on function public.has_permission(text) to anon, authenticated, service_role;

-- Everything in the household is shared: any member reads all of it.
create policy "members read households"
  on public.households for select to authenticated
  using ((select public.is_member()));

create policy "members read roles"
  on public.roles for select to authenticated
  using ((select public.is_member()));

create policy "members read role permissions"
  on public.role_permissions for select to authenticated
  using ((select public.is_member()));

create policy "members read memberships"
  on public.household_members for select to authenticated
  using ((select public.is_member()));

-- Changing who is in the household, and what roles exist, needs a key.
create policy "manage memberships"
  on public.household_members for all to authenticated
  using ((select public.has_permission('manage_members')))
  with check ((select public.has_permission('manage_members')));

create policy "manage roles"
  on public.roles for all to authenticated
  using ((select public.has_permission('manage_roles')))
  with check ((select public.has_permission('manage_roles')));

create policy "manage role permissions"
  on public.role_permissions for all to authenticated
  using ((select public.has_permission('manage_roles')))
  with check ((select public.has_permission('manage_roles')));

-- A role with max_holders set can't be given to more people than that.
create function public.enforce_role_holder_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limit_holders integer;
  current_holders integer;
begin
  select max_holders into limit_holders
  from public.roles
  where id = new.role_id;

  if limit_holders is null then
    return new;
  end if;

  select count(*) into current_holders
  from public.household_members
  where household_id = new.household_id
    and role_id = new.role_id
    and user_id <> new.user_id;

  if current_holders >= limit_holders then
    raise exception 'This role already has its maximum of % holders', limit_holders;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_role_holder_limit() from public;

create trigger enforce_role_holder_limit
  before insert or update of role_id, household_id on public.household_members
  for each row execute function public.enforce_role_holder_limit();
