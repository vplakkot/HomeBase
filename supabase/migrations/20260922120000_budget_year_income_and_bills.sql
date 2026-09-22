-- Finances setup, done by an admin once a year (REQ-50, REQ-51, REQ-94):
-- the split percentage for a budget year running April to March, each
-- person's income sources, and the household's list of bills. There is
-- one household, so like everything before it these tables don't carry a
-- household id: being a member is what lets you in.

-- A new key for the setup, handed to Admin. The rules below ask for the
-- key, never for the role.
insert into public.role_permissions (role_id, permission)
select id, 'manage_budget' from public.roles where name = 'Admin';

-- A budget year is named by the year its April falls in: 2026 runs from
-- April 2026 to March 2027. The note records the income and savings
-- assumptions the percentages were based on.
create table public.budget_years (
  id uuid primary key default gen_random_uuid(),
  start_year integer not null unique check (start_year between 2000 and 2999),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.budget_year_shares (
  budget_year_id uuid not null references public.budget_years (id) on delete cascade,
  user_id uuid not null references public.household_members (user_id) on delete cascade,
  percent numeric(5, 2) not null check (percent >= 0 and percent <= 100),
  primary key (budget_year_id, user_id)
);

-- Pay is recorded as it lands: a net amount per payment, how often, and
-- one known payday to count from.
create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.household_members (user_id) on delete cascade,
  net_amount numeric(12, 2) not null check (net_amount > 0),
  cadence text not null check (cadence in ('weekly', 'biweekly', 'monthly')),
  anchor_date date not null,
  created_at timestamptz not null default now()
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  kind text not null check (kind in ('rent', 'card', 'other')),
  due_day integer not null check (due_day between 1 and 31),
  created_at timestamptz not null default now()
);

alter table public.budget_years enable row level security;
alter table public.budget_year_shares enable row level security;
alter table public.income_sources enable row level security;
alter table public.bills enable row level security;

-- A second lock for signed-out visitors, as for the tables before these:
-- every policy below is for signed-in people only, and this takes away
-- the table access Supabase grants the anon role by default.
revoke all on public.budget_years from anon;
revoke all on public.budget_year_shares from anon;
revoke all on public.income_sources from anon;
revoke all on public.bills from anon;

-- Everything in the household is shared: any member reads all of it. Only
-- the manage_budget key changes it.
create policy "members read budget years"
  on public.budget_years for select to authenticated
  using ((select public.is_member()));

create policy "manage budget years"
  on public.budget_years for all to authenticated
  using ((select public.has_permission('manage_budget')))
  with check ((select public.has_permission('manage_budget')));

create policy "members read budget year shares"
  on public.budget_year_shares for select to authenticated
  using ((select public.is_member()));

create policy "manage budget year shares"
  on public.budget_year_shares for all to authenticated
  using ((select public.has_permission('manage_budget')))
  with check ((select public.has_permission('manage_budget')));

create policy "members read income sources"
  on public.income_sources for select to authenticated
  using ((select public.is_member()));

create policy "manage income sources"
  on public.income_sources for all to authenticated
  using ((select public.has_permission('manage_budget')))
  with check ((select public.has_permission('manage_budget')));

create policy "members read bills"
  on public.bills for select to authenticated
  using ((select public.is_member()));

create policy "manage bills"
  on public.bills for all to authenticated
  using ((select public.has_permission('manage_budget')))
  with check ((select public.has_permission('manage_budget')));

-- A budget year's percentages must total exactly 100. The rule spans
-- several rows, so it is checked when the transaction commits, once every
-- row is in: a check on each row as it arrives would refuse the first
-- share because the second isn't there yet. It runs whenever a year is saved
-- (a year with no shares totals 0) and whenever a share is written.
-- Deleting a share isn't checked, so removing a person from the household
-- is never blocked by an old budget year; the year's total then drops
-- below 100 until an admin saves it again.
create function public.check_budget_year_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  year_id uuid;
  total numeric;
begin
  if tg_table_name = 'budget_years' then
    year_id := new.id;
  else
    year_id := new.budget_year_id;
  end if;

  select coalesce(sum(percent), 0) into total
  from public.budget_year_shares
  where budget_year_id = year_id;

  if total <> 100 then
    raise exception 'The percentages must total 100; these total %', total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

revoke all on function public.check_budget_year_total() from public, anon, authenticated;

create constraint trigger budget_year_total_on_save
  after insert or update on public.budget_years
  deferrable initially deferred
  for each row execute function public.check_budget_year_total();

create constraint trigger budget_year_total_on_share
  after insert or update on public.budget_year_shares
  deferrable initially deferred
  for each row execute function public.check_budget_year_total();

-- Saves a budget year and all its shares in one transaction, so the total
-- is checked once, over the whole set. Saving a start year that already
-- exists replaces its note and shares. It runs as the caller, so the
-- policies above decide whether they may.
create function public.save_budget_year(
  p_start_year integer,
  p_note text,
  p_shares jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  year_id uuid;
begin
  insert into public.budget_years (start_year, note)
  values (p_start_year, coalesce(p_note, ''))
  on conflict (start_year) do update set note = excluded.note
  returning id into year_id;

  delete from public.budget_year_shares where budget_year_id = year_id;

  insert into public.budget_year_shares (budget_year_id, user_id, percent)
  select year_id, (share ->> 'user_id')::uuid, (share ->> 'percent')::numeric
  from jsonb_array_elements(p_shares) as share;

  return year_id;
end;
$$;

revoke all on function public.save_budget_year(integer, text, jsonb) from public, anon;
grant execute on function public.save_budget_year(integer, text, jsonb) to authenticated;

-- The people in the household, for any member: who a percentage or an
-- income source belongs to, and who a member should ask to set things up.
-- A person without a name shows the first part of their email instead.
create function public.household_people()
returns table (user_id uuid, name text, manages_budget boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    hm.user_id,
    coalesce(nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1)),
    exists (
      select 1
      from public.role_permissions rp
      where rp.role_id = hm.role_id
        and rp.permission = 'manage_budget'
    )
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  where (select public.is_member())
  order by hm.created_at, hm.user_id;
$$;

revoke all on function public.household_people() from public, anon;
grant execute on function public.household_people() to authenticated;
