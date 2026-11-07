-- The next month opens on the last day of the one running, so its bills
-- can be entered before rent and the cards fall due. As before
-- (20260925120000_months_open_themselves.sql) the job opens the month now
-- running; on that month's last day, New York time, it opens the next one
-- too, the same way: rent pre-filled, card statements waiting. The month
-- still counts as running only from the 1st, so Finances home and the
-- action items keep showing the one in progress until then.
create or replace function public.open_current_month(
  p_today date default (now() at time zone 'America/New_York')::date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts date := date_trunc('month', p_today)::date;
  next_starts date := date_trunc('month', p_today + 1)::date;
  opened uuid;
begin
  if not exists (select 1 from public.splits where effective_from <= starts)
     or not exists (select 1 from public.bills) then
    return null;
  end if;
  opened := public.create_month(starts);
  -- Only on the last day: tomorrow falls in a different month.
  if next_starts <> starts
     and exists (select 1 from public.splits where effective_from <= next_starts) then
    perform public.create_month(next_starts);
  end if;
  return opened;
end;
$$;

revoke all on function public.open_current_month(date) from public, anon, authenticated;
