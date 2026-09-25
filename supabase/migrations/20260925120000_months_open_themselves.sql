-- REQ-101: each month opens itself. Until now a month was opened by the
-- first person to visit Monthly entry; from here a scheduled job opens
-- the month now running, the way it would have been opened by hand: rent
-- pre-filled with its amount, card statements waiting for theirs. A
-- person opening it first still works, and whichever comes second finds
-- it already there.

-- What opening a month does, shared by the person (open_month) and the
-- job (open_current_month). Two openers racing is harmless: the second
-- insert does nothing and copies no bills, so the list isn't doubled.
create function public.create_month(p_starts date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_month uuid;
begin
  insert into public.months (starts_on) values (p_starts)
  on conflict (starts_on) do nothing
  returning id into the_month;
  if the_month is null then
    select id into the_month from public.months where starts_on = p_starts;
    return the_month;
  end if;

  insert into public.month_bills (month_id, bill_id, name, kind, due_day, amount, entered_at)
  select the_month, id, name, kind, due_day, amount,
         case when amount is not null then now() end
  from public.bills;
  return the_month;
end;
$$;

revoke all on function public.create_month(date) from public, anon, authenticated;

create or replace function public.open_month(p_month date, p_today date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts date := date_trunc('month', p_month)::date;
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can open a month'
      using errcode = 'insufficient_privilege';
  end if;
  if starts <> date_trunc('month', p_today)::date then
    raise exception 'Only the month now running can be opened'
      using errcode = 'check_violation';
  end if;
  return public.create_month(starts);
end;
$$;

-- The job. pg_cron runs on UTC, so it asks what month it is in New York.
-- It does nothing until a split is in force: before the budget year is
-- set up there is no month to run. p_today is there for the live check.
create function public.open_current_month(
  p_today date default (now() at time zone 'America/New_York')::date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts date := date_trunc('month', p_today)::date;
begin
  if not exists (select 1 from public.splits where effective_from <= starts) then
    return null;
  end if;
  return public.create_month(starts);
end;
$$;

revoke all on function public.open_current_month(date) from public, anon, authenticated;

select cron.schedule(
  'open-current-month',
  -- Two minutes past every hour: the first run after midnight on the 1st
  -- in New York opens the month; every other run finds it open.
  '2 * * * *',
  $job$ select public.open_current_month(); $job$
);
