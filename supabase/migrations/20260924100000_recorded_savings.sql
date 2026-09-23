-- What was actually saved in a month (REQ-66): for each person, what
-- they put into joint savings and what they saved on their own. The app
-- works out what was available from the month's own figures, so only
-- what really happened is stored here, to set beside it.
--
-- Saving usually happens after a month ends, so these rows stay open to
-- change even once the month is closed: they describe money that moved
-- afterwards, not the month's bills.

create table public.month_savings (
  month_id uuid not null references public.months (id) on delete cascade,
  user_id uuid not null references public.household_members (user_id) on delete cascade,
  to_joint numeric(12, 2) not null default 0 check (to_joint >= 0),
  own numeric(12, 2) not null default 0 check (own >= 0),
  updated_at timestamptz not null default now(),
  primary key (month_id, user_id)
);

alter table public.month_savings enable row level security;
revoke all on public.month_savings from anon;

-- Recording is shared, like logging income: any member records it for
-- either person.
create policy "members read savings"
  on public.month_savings for select to authenticated
  using ((select public.is_member()));

create policy "members record savings"
  on public.month_savings for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members correct savings"
  on public.month_savings for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));
