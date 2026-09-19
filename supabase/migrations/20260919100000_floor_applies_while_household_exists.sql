-- A floor on a role (min_holders) exists to keep a *living* household
-- manageable: never leave it without an admin. enforce_role_holder_minimum
-- also fires on DELETE of household_members, and a household_members row
-- is deleted by cascade when the household itself is deleted — so the rule
-- refused to let a household be torn down at all.
--
-- The floor now applies only while the household still exists. Every other
-- removal stays guarded, including deleting the account of the last admin:
-- that would leave members behind with nobody able to manage them, so it
-- is refused and the hint says what to do instead.

create or replace function public.enforce_role_holder_minimum()
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

  -- Deleting a household cascades to its memberships. Postgres has already
  -- removed the household row by the time this runs, and a floor on a
  -- household that no longer exists protects nobody.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.households where id = old.household_id) then
    return old;
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
      raise exception 'This role must keep at least % holder(s)', minimum
        using hint = 'Give the role to someone else first, or delete the household itself.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_role_holder_minimum() from public;
