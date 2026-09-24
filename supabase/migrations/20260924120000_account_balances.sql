-- Account balances, entered once a month (REQ-67): for each person, what
-- their 401k, ESPP, RSU, investments and cash stood at. One row per
-- month, person and account; an account left blank has no row, so the
-- gap stays visible rather than reading as $0.
--
-- A balance month is just a calendar month ("YYYY-MM-01"), not a row in
-- months: balances can be entered whether or not that month's bills were
-- ever opened, and they describe accounts, not the household's bills, so
-- closing a month doesn't lock them.

create table public.balances (
  month date not null check (extract(day from month) = 1),
  user_id uuid not null references public.household_members (user_id) on delete cascade,
  account text not null check (account in ('401k', 'espp', 'rsu', 'investments', 'cash')),
  amount numeric(14, 2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (month, user_id, account)
);

alter table public.balances enable row level security;
revoke all on public.balances from anon;

-- Entering is shared, like savings: any member enters either person's.
create policy "members read balances"
  on public.balances for select to authenticated
  using ((select public.is_member()));

create policy "members enter balances"
  on public.balances for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members correct balances"
  on public.balances for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

-- Clearing a box, or removing a month's balances, deletes rows; nothing
-- entered by mistake is ever stuck.
create policy "members remove balances"
  on public.balances for delete to authenticated
  using ((select public.has_permission('use_modules')));
