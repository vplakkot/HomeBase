-- REQ-148: filling in earlier months of this budget year, added later.
--
-- Until now only the month now running could be opened. A household
-- that started partway through the year can now add any earlier month
-- of the current budget year (April to March) that was never opened.
-- It is opened the same way (today's bill list, rent pre-filled) and
-- marked "added later".
--
-- A month added later carries its own split: a copy of the split in
-- force then, or of today's if none had started, which either member
-- may change for that month only. The household's dated splits are
-- never touched, so the rule that a split already past is history
-- still holds (docs/lessons/20-rows-with-a-life.md).
--
-- It can be closed as "settled": sorted out between us outside the
-- app. That writes nobody owing anything onto it, so it changes
-- nothing anyone owes today. Paying it off as usual works too.

alter table public.months
  add column added_later boolean not null default false,
  add column settled boolean not null default false;

create table public.month_shares (
  month_id uuid not null references public.months (id) on delete cascade,
  user_id uuid not null references public.household_members (user_id) on delete restrict,
  percent numeric(5, 2) not null check (percent >= 0 and percent <= 100),
  primary key (month_id, user_id)
);

alter table public.month_shares enable row level security;
revoke all on public.month_shares from anon;

-- Written only by the functions below.
create policy "members read month shares"
  on public.month_shares for select to authenticated
  using ((select public.is_member()));

-- The first month of the budget year p_today falls in.
create function public.budget_year_start(p_today date)
returns date
language sql
immutable
set search_path = ''
as $$
  select make_date(
    extract(year from p_today)::integer - case when extract(month from p_today) < 4 then 1 else 0 end,
    4, 1);
$$;

-- Adds an earlier month of this budget year. The day is passed in
-- because the server's clock isn't the household's.
create function public.add_past_month(p_month date, p_today date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts date := date_trunc('month', p_month)::date;
  the_split uuid;
  the_month uuid;
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can add a month'
      using errcode = 'insufficient_privilege';
  end if;
  if starts >= date_trunc('month', p_today)::date or starts < public.budget_year_start(p_today) then
    raise exception 'Only an earlier month of this budget year can be added'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.months where starts_on = starts) then
    raise exception 'That month is already there'
      using errcode = 'unique_violation';
  end if;

  select id into the_split from public.splits
  where effective_from <= starts order by effective_from desc limit 1;
  if the_split is null then
    select id into the_split from public.splits
    where effective_from <= date_trunc('month', p_today)::date
    order by effective_from desc limit 1;
  end if;
  if the_split is null then
    raise exception 'Set up the budget year first'
      using errcode = 'check_violation';
  end if;

  the_month := public.create_month(starts);
  update public.months set added_later = true where id = the_month;
  insert into public.month_shares (month_id, user_id, percent)
  select the_month, user_id, percent from public.split_shares where split_id = the_split;
  return the_month;
end;
$$;

revoke all on function public.add_past_month(date, date) from public, anon;
grant execute on function public.add_past_month(date, date) to authenticated;

-- Changes a month-added-later's own split, while it's open. Like every
-- split, the percentages must total 100.
create function public.set_month_split(p_month uuid, p_shares jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  total numeric;
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can change the split'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.months
                 where id = p_month and added_later and closed_at is null) then
    raise exception 'Only an open month added later has its own split'
      using errcode = 'check_violation';
  end if;
  select coalesce(sum((share ->> 'percent')::numeric), 0) into total
  from jsonb_array_elements(p_shares) as share;
  if total <> 100 then
    raise exception 'The percentages must total 100; these total %', total
      using errcode = 'check_violation';
  end if;

  delete from public.month_shares where month_id = p_month;
  insert into public.month_shares (month_id, user_id, percent)
  select p_month, (share ->> 'user_id')::uuid, (share ->> 'percent')::numeric
  from jsonb_array_elements(p_shares) as share;
end;
$$;

revoke all on function public.set_month_split(uuid, jsonb) from public, anon;
grant execute on function public.set_month_split(uuid, jsonb) to authenticated;

-- As before (20260923220000_closing_a_month.sql), with one change: an
-- open month with its own split divides by that.
create or replace function public.month_balances(p_month uuid)
returns table (user_id uuid, percent numeric, outstanding numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  the_month public.months;
  own boolean;
  base numeric;
begin
  select * into the_month from public.months where id = p_month;
  own := exists (select 1 from public.month_shares ms where ms.month_id = p_month);
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
    select ms.user_id, ms.percent from public.month_shares ms
    where ms.month_id = p_month and the_month.closed_at is null and own
    union all
    select ss.user_id, ss.percent from public.split_shares ss
    where the_month.closed_at is null and not own
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

revoke all on function public.month_balances(uuid) from public, anon, authenticated;

-- As before (20260923230000_closed_months_keep_their_record.sql), with
-- one change: a month on its own split names no household split.
create or replace function public.close_month(p_month uuid, p_by uuid)
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
      closed_automatically = p_by is null,
      split_from = case
        when exists (select 1 from public.month_shares ms where ms.month_id = p_month) then null
        else (select s.effective_from from public.splits s
              where s.effective_from <= the_month.starts_on
              order by s.effective_from desc limit 1)
      end
  where id = p_month;
end;
$$;

revoke all on function public.close_month(uuid, uuid) from public, anon, authenticated;

-- Closes a month added later as settled: sorted out between us outside
-- the app. Either member may. Every bill must be entered first, so the
-- year's totals have the whole month; the percentages are written on
-- it and nobody owes anything for it.
create function public.settle_past_month(p_month uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_month public.months;
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can settle a month'
      using errcode = 'insufficient_privilege';
  end if;
  select * into the_month from public.months where id = p_month for update;
  if the_month.id is null or not the_month.added_later or the_month.closed_at is not null then
    raise exception 'Only an open month added later can be settled'
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
    raise exception 'Enter every bill before settling the month'
      using errcode = 'check_violation';
  end if;
  insert into public.month_people (month_id, user_id, percent, outstanding)
  select p_month, b.user_id, b.percent, 0 from public.month_balances(p_month) b;
  update public.months
  set closed_at = now(),
      closed_by = (select auth.uid()),
      settled = true,
      split_from = null
  where id = p_month;
end;
$$;

revoke all on function public.settle_past_month(uuid) from public, anon;
grant execute on function public.settle_past_month(uuid) to authenticated;
