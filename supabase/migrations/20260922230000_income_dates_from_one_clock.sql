-- Follow-ups from the review of #132.
--
-- Two things about the dates an income source carries. First, which day
-- it is has to come from the household's own clock (America/New_York),
-- the same one every other Finances date reads; current_date here is the
-- server's, and for four hours each evening that is tomorrow. So the app
-- passes the day in. Second, the rows that existed when the column was
-- added were stamped with the day the migration ran; the day they were
-- created is truer, and the same on any replay.
--
-- The convention these dates follow, which REQ-52 will read: a source is
-- in force on a day when effective_from <= day and (ended_on is null or
-- day < ended_on). ended_on is the first day it no longer counts, so a
-- source that ends and its replacement, both stamped the same day, hand
-- over cleanly with no day counted twice.

update public.income_sources
set effective_from = created_at::date
where effective_from > created_at::date;

drop function public.change_income_source(uuid, text, uuid, numeric, text, date);

create function public.change_income_source(
  p_id uuid,
  p_name text,
  p_owner_id uuid,
  p_net_amount numeric,
  p_cadence text,
  p_anchor_date date,
  p_on date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  update public.income_sources
  set ended_on = p_on
  where id = p_id and ended_on is null;

  if not found then
    raise exception 'That income source is not in force';
  end if;

  insert into public.income_sources (name, owner_id, net_amount, cadence, anchor_date, effective_from)
  values (p_name, p_owner_id, p_net_amount, p_cadence, p_anchor_date, p_on)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.change_income_source(uuid, text, uuid, numeric, text, date, date)
  from public, anon;
grant execute on function public.change_income_source(uuid, text, uuid, numeric, text, date, date)
  to authenticated;
