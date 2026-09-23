-- Closing a month (REQ-59, REQ-52), and income received in it (REQ-60).
--
-- A month is squared when every bill is entered and paid in full and
-- each person's balance is exactly zero. A squared month closes on its
-- own when its day ends: a job runs just after midnight, household time,
-- and closes every month that is squared at that moment. A month with a
-- balance left closes only when an admin does it, deliberately.
--
-- Closing is like signing off a paper ledger: the percentages in force
-- and whatever was still owed are written onto the month, and from then
-- on nothing in it can be added, changed or removed.

alter table public.months
  add column closed_at timestamptz,
  -- Who closed it. Empty on a closed month means it closed on its own.
  add column closed_by uuid references public.household_members (user_id) on delete set null,
  -- The month the split it ran on started (REQ-52: which one produced it).
  add column split_from date;

-- One row per person on a closed month: the percentage they paid at, and
-- what they still owed when it closed (a credit is below zero).
create table public.month_people (
  month_id uuid not null references public.months (id) on delete cascade,
  user_id uuid not null references public.household_members (user_id) on delete cascade,
  percent numeric(5, 2) not null,
  outstanding numeric(12, 2) not null,
  primary key (month_id, user_id)
);

alter table public.month_people enable row level security;
revoke all on public.month_people from anon;

-- Only close_month below writes here.
create policy "members read month people"
  on public.month_people for select to authenticated
  using ((select public.is_member()));

-- Money that landed in the month (REQ-60). A paycheck confirmed from an
-- income source keeps which source and payday it was, so the same
-- payday can't be confirmed twice. Shares kept rather than sold aren't
-- income, so there is no "held" kind.
create table public.month_income (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.months (id) on delete cascade,
  owner_id uuid not null references public.household_members (user_id) on delete cascade,
  kind text not null check (kind in ('paycheck', 'espp', 'rsu', 'bonus', 'other')),
  amount numeric(12, 2) not null check (amount > 0),
  received_on date not null,
  income_source_id uuid references public.income_sources (id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (income_source_id, received_on)
);

create index month_income_month_id_idx on public.month_income (month_id);

alter table public.month_income enable row level security;
revoke all on public.month_income from anon;

create policy "members read income"
  on public.month_income for select to authenticated
  using ((select public.is_member()));

create policy "members log income"
  on public.month_income for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members remove income"
  on public.month_income for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- What each person still owes in a month, worked out the same way as
-- monthTotals() in lib/finances/month.ts, in cents: the shared base is
-- the bills less personal charges plus one-time payments; each share is
-- rounded to the cent and the last person, in user_id order, takes the
-- cent the rounding left. A closed month uses the percentages written on
-- it; an open one the split that had started by its first day.
create function public.month_balances(p_month uuid)
returns table (user_id uuid, percent numeric, outstanding numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  the_month public.months;
  base numeric;
begin
  select * into the_month from public.months where id = p_month;

  select
    coalesce((select sum(round(mb.amount * 100)) from public.month_bills mb
              where mb.month_id = p_month), 0)
    - coalesce((select sum(round(pc.amount * 100)) from public.personal_charges pc
                join public.month_bills mb on mb.id = pc.month_bill_id
                where mb.month_id = p_month), 0)
    + coalesce((select sum(round(dp.amount * 100)) from public.direct_payments dp
                where dp.month_id = p_month), 0)
  into base;

  return query
  with shares as (
    select mp.user_id, mp.percent from public.month_people mp
    where mp.month_id = p_month and the_month.closed_at is not null
    union all
    select ss.user_id, ss.percent from public.split_shares ss
    where the_month.closed_at is null
      and ss.split_id = (select s.id from public.splits s
                         where s.effective_from <= the_month.starts_on
                         order by s.effective_from desc limit 1)
  ),
  rounded as (
    select s.user_id, s.percent, round(base * s.percent / 100) as part,
           row_number() over (order by s.user_id desc) as from_last,
           sum(round(base * s.percent / 100)) over () as all_parts
    from shares s
  ),
  parts as (
    select r.user_id, r.percent,
           case when r.from_last = 1 then base - (r.all_parts - r.part) else r.part end as part
    from rounded r
  )
  select p.user_id, p.percent,
    (p.part
     + coalesce((select sum(round(pc.amount * 100)) from public.personal_charges pc
                 join public.month_bills mb on mb.id = pc.month_bill_id
                 where mb.month_id = p_month and pc.owner_id = p.user_id), 0)
     - coalesce((select sum(round(dp.amount * 100)) from public.direct_payments dp
                 where dp.month_id = p_month and dp.payer_id = p.user_id), 0)
     - coalesce((select sum(round(pay.amount * 100)) from public.payments pay
                 join public.month_bills mb on mb.id = pay.month_bill_id
                 where mb.month_id = p_month and pay.payer_id = p.user_id), 0)
    ) / 100
  from parts p;
end;
$$;

revoke all on function public.month_balances(uuid) from public, anon;
grant execute on function public.month_balances(uuid) to authenticated;

-- Squared: a split to divide by, every bill entered (a card statement
-- also needs its personal-charges answer settled) and paid in full, and
-- nobody owing or owed anything. Mirrors monthStatus() in the app.
create function public.month_is_squared(p_month uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.month_balances(p_month))
    and not exists (
      select 1 from public.month_bills mb
      where mb.month_id = p_month
        and (
          mb.amount is null
          or (mb.kind = 'card' and mb.personal_answer is null)
          or (mb.kind = 'card' and mb.personal_answer = 'some'
              and not exists (select 1 from public.personal_charges pc where pc.month_bill_id = mb.id))
          or mb.amount <> coalesce((select sum(pay.amount) from public.payments pay
                                    where pay.month_bill_id = mb.id), 0)
        )
    )
    and not exists (select 1 from public.month_balances(p_month) b where b.outstanding <> 0);
$$;

revoke all on function public.month_is_squared(uuid) from public, anon;
grant execute on function public.month_is_squared(uuid) to authenticated;

-- Writes the split and the balances onto the month and closes it.
-- Called only by the two functions below.
create function public.close_month(p_month uuid, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_month public.months;
begin
  select * into the_month from public.months where id = p_month for update;
  if the_month.closed_at is not null then
    return;
  end if;

  insert into public.month_people (month_id, user_id, percent, outstanding)
  select p_month, b.user_id, b.percent, b.outstanding from public.month_balances(p_month) b;

  update public.months
  set closed_at = now(),
      closed_by = p_by,
      split_from = (select s.effective_from from public.splits s
                    where s.effective_from <= the_month.starts_on
                    order by s.effective_from desc limit 1)
  where id = p_month;
end;
$$;

revoke all on function public.close_month(uuid, uuid) from public, anon, authenticated;

-- An admin closes a month that still has a balance (REQ-59). It needs a
-- split and every bill entered, so what's recorded is the whole month.
create function public.close_month_with_balance(p_month uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('manage_budget') then
    raise exception 'Only an admin can close a month with a balance'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.months where id = p_month and closed_at is null) then
    raise exception 'That month is not open'
      using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.month_balances(p_month)) then
    raise exception 'There is no split to close the month with'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.month_bills mb
    where mb.month_id = p_month
      and (mb.amount is null
           or (mb.kind = 'card' and mb.personal_answer is null)
           or (mb.kind = 'card' and mb.personal_answer = 'some'
               and not exists (select 1 from public.personal_charges pc where pc.month_bill_id = mb.id)))
  ) then
    raise exception 'Enter every bill before closing the month'
      using errcode = 'check_violation';
  end if;
  perform public.close_month(p_month, (select auth.uid()));
end;
$$;

revoke all on function public.close_month_with_balance(uuid) from public, anon;
grant execute on function public.close_month_with_balance(uuid) to authenticated;

-- The nightly close. pg_cron runs on UTC, and midnight in New York is
-- 04:00 or 05:00 UTC depending on the season, so the job runs every hour
-- and does its work only in the hour after midnight, household time.
create function public.close_squared_months()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_month uuid;
begin
  if extract(hour from now() at time zone 'America/New_York') <> 0 then
    return;
  end if;
  for the_month in select id from public.months where closed_at is null loop
    if public.month_is_squared(the_month) then
      perform public.close_month(the_month, null);
    end if;
  end loop;
end;
$$;

revoke all on function public.close_squared_months() from public, anon, authenticated;

select cron.schedule(
  'close-squared-months',
  -- Five past every hour; only the one after midnight in New York acts.
  '5 * * * *',
  $job$ select public.close_squared_months(); $job$
);

-- Nothing in a closed month changes: its bills, personal charges,
-- one-time payments and payments are refused, whichever way the write
-- comes. A payment moved from one bill to another is checked at both.
create function public.refuse_closed_month()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows_months uuid[] := '{}';
  bill_ids uuid[] := '{}';
begin
  -- Removing a bill from the household's list lets go of its copies in
  -- every month (bill_id is set to empty); that isn't a change to the
  -- month, so it's let through.
  if tg_table_name = 'month_bills' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'bill_id') = (to_jsonb(old) - 'bill_id') then
    return new;
  end if;

  if tg_table_name in ('month_bills', 'direct_payments') then
    if tg_op <> 'INSERT' then rows_months := rows_months || old.month_id; end if;
    if tg_op <> 'DELETE' then rows_months := rows_months || new.month_id; end if;
  else
    if tg_op <> 'INSERT' then bill_ids := bill_ids || old.month_bill_id; end if;
    if tg_op <> 'DELETE' then bill_ids := bill_ids || new.month_bill_id; end if;
    select array_agg(mb.month_id) into rows_months
    from public.month_bills mb where mb.id = any(bill_ids);
  end if;

  if exists (select 1 from public.months m where m.id = any(rows_months) and m.closed_at is not null) then
    raise exception 'This month is closed'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.refuse_closed_month() from public, anon, authenticated;

create trigger month_bills_stay_closed
  before insert or update or delete on public.month_bills
  for each row execute function public.refuse_closed_month();
create trigger personal_charges_stay_closed
  before insert or update or delete on public.personal_charges
  for each row execute function public.refuse_closed_month();
create trigger direct_payments_stay_closed
  before insert or update or delete on public.direct_payments
  for each row execute function public.refuse_closed_month();
create trigger payments_stay_closed
  before insert or update or delete on public.payments
  for each row execute function public.refuse_closed_month();

-- Income is received on a day inside its month. A squared month can
-- close before the month is out, and a paycheck can still land after
-- that, so income stays open until the month has closed and its last
-- day has gone by on the household's clock.
create function public.check_month_income()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_month public.months;
  today date := (now() at time zone 'America/New_York')::date;
begin
  select * into the_month from public.months
  where id = case when tg_op = 'DELETE' then old.month_id else new.month_id end;

  if the_month.closed_at is not null and today >= (the_month.starts_on + interval '1 month')::date then
    raise exception 'This month is closed'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT'
     and (new.received_on < the_month.starts_on
          or new.received_on >= (the_month.starts_on + interval '1 month')::date) then
    raise exception 'Income belongs to the month it was received in'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.check_month_income() from public, anon, authenticated;

create trigger month_income_fits_its_month
  before insert or delete on public.month_income
  for each row execute function public.check_month_income();
