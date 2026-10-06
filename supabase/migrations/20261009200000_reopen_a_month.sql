-- An admin can reopen a closed month (Vin, 2026-10-06): closing locks a
-- month's bills and payments, but a mistake found afterwards, or a month
-- closed too early, shouldn't be stuck.
--
-- Reopening gives the month back as it was before it closed: the people
-- rows written at closing are removed (closing writes them again), and
-- the month is open, so its lock lifts. It is remembered as reopened,
-- because the nightly job closes every squared month on its own, and a
-- month an admin deliberately reopened must stay open until an admin
-- closes it again. Only ADDS columns and a function, and changes the
-- nightly job to skip a reopened month, so the running app is unaffected.

alter table public.months
  add column reopened_at timestamptz,
  add column reopened_by uuid references public.household_members (user_id) on delete set null;

create function public.reopen_month(p_month uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_month public.months;
begin
  if not public.has_permission('manage_budget') then
    raise exception 'Only an admin can reopen a month'
      using errcode = 'insufficient_privilege';
  end if;
  select * into the_month from public.months where id = p_month for update;
  if the_month.id is null or the_month.closed_at is null then
    raise exception 'That month is not closed'
      using errcode = 'no_data_found';
  end if;
  delete from public.month_people where month_id = p_month;
  update public.months
  set closed_at = null,
      closed_by = null,
      closed_automatically = false,
      settled = false,
      split_from = null,
      reopened_at = now(),
      reopened_by = (select auth.uid())
  where id = p_month;
end;
$$;

revoke all on function public.reopen_month(uuid) from public, anon;
grant execute on function public.reopen_month(uuid) to authenticated;

-- As before (20260923220000_closing_a_month.sql), skipping a month an admin
-- reopened: it closes only when an admin closes it.
create or replace function public.close_squared_months()
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
  for the_month in select id from public.months where closed_at is null and reopened_at is null loop
    if public.month_is_squared(the_month) then
      perform public.close_month(the_month, null);
    end if;
  end loop;
end;
$$;

revoke all on function public.close_squared_months() from public, anon, authenticated;
