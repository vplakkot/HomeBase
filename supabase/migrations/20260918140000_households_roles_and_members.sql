-- The household structure everything else hangs off. Roles are rows, not
-- code: REQ-12 adds their permissions and row-level security policies.
-- The first sign-up creates the single household and becomes its Admin;
-- every later self sign-up is refused by the trigger at the bottom.

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.roles (name) values ('Admin'), ('Member');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.household_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  role_id uuid not null references public.roles (id),
  created_at timestamptz not null default now()
);

-- RLS on with no policies means the API can neither read nor write these
-- tables at all until REQ-12 adds the policies.
alter table public.roles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- The one fact a signed-out visitor may learn: whether sign-up is still open.
create function public.household_exists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.households);
$$;

revoke all on function public.household_exists() from public;
grant execute on function public.household_exists() to anon, authenticated, service_role;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid;
  admin_role_id uuid;
begin
  if exists (select 1 from public.households) then
    raise exception 'Sign-up is closed: the household already exists';
  end if;

  insert into public.households default values
  returning id into new_household_id;

  select id into admin_role_id from public.roles where name = 'Admin';

  insert into public.household_members (user_id, household_id, role_id)
  values (new.id, new_household_id, admin_role_id);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
