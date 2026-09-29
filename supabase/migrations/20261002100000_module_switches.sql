-- Modules on and off (REQ-141, REQ-142, REQ-143).
--
-- The list of modules lives in the code (lib/modules.ts). What lives here
-- is which of them the household has turned off, and which each person
-- has hidden from their own view. Neither touches a module's data:
-- turning one back on, or showing it again, brings back exactly what was
-- there.

-- Only the admin turns modules on and off. A permission, not a role's
-- name, like every other rule here.
insert into public.role_permissions (role_id, permission)
select id, 'manage_modules' from public.roles where name = 'Admin';

-- REQ-141: a row means that switch is off for everyone. The name is the
-- switch's, so Paperwork and Storage, which share one switch, are one row
-- ("paperwork").
create table public.modules_off (
  module text primary key check (module ~ '^[a-z][a-z-]*$'),
  turned_off_at timestamptz not null default now()
);

alter table public.modules_off enable row level security;
revoke all on public.modules_off from anon;

create policy "members read modules off"
  on public.modules_off for select to authenticated
  using ((select public.is_member()));

create policy "admins turn modules off"
  on public.modules_off for insert to authenticated
  with check ((select public.has_permission('manage_modules')));

create policy "admins turn modules on"
  on public.modules_off for delete to authenticated
  using ((select public.has_permission('manage_modules')));

-- REQ-143: a row means that person has hidden that module from their own
-- navigation and Home cards. Nobody else sees it or can change it.
create table public.modules_hidden (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  module text not null check (module ~ '^[a-z][a-z-]*$'),
  primary key (user_id, module)
);

alter table public.modules_hidden enable row level security;
revoke all on public.modules_hidden from anon;

create policy "people read their own hidden modules"
  on public.modules_hidden for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

create policy "people hide modules for themselves"
  on public.modules_hidden for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_member()));

create policy "people show modules again"
  on public.modules_hidden for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

-- REQ-142: whether the household's modules have been chosen yet. A new
-- household starts without, and its admin is asked once. The household
-- that already exists has been using every module, so it counts as chosen.
alter table public.households
  add column modules_chosen boolean not null default false;

update public.households set modules_chosen = true;

-- The setup step's one write: the modules left out start off, and the
-- household is marked as chosen, together. It only works once, so a
-- second tab or a replay can't turn modules off behind the admin switch.
create function public.choose_modules(left_out text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('manage_modules') then
    raise exception 'Only an admin chooses the household''s modules';
  end if;

  update public.households set modules_chosen = true where modules_chosen = false;
  if not found then
    raise exception 'The household''s modules are already chosen';
  end if;

  insert into public.modules_off (module)
  select distinct unnest(coalesce(left_out, '{}'))
  on conflict (module) do nothing;
end;
$$;

revoke all on function public.choose_modules(text[]) from public;
grant execute on function public.choose_modules(text[]) to authenticated;
