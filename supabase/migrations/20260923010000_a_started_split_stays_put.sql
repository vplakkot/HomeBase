-- Follow-ups from the second review of #132.
--
-- The screen refuses to change a split whose month has already passed,
-- but the database happily did it: save_split upserts on the month, so
-- saving "from April 2026" again replaced April's shares — through the
-- Add form as easily as through Edit. The rule belongs here too, where a
-- stale page can't get round it.
--
-- The day is passed in, like every other Finances date, because the
-- server's own clock is four hours ahead of the household's in the
-- evening (docs/lessons/20-rows-with-a-life.md).

drop function public.save_split(date, text, jsonb);

create function public.save_split(
  p_effective_from date,
  p_note text,
  p_shares jsonb,
  p_today date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  the_split uuid;
  starts date := date_trunc('month', p_effective_from)::date;
begin
  if starts < date_trunc('month', p_today)::date then
    raise exception 'That split has already started, so it stays as it is'
      using errcode = 'check_violation';
  end if;

  insert into public.splits (effective_from, note)
  values (starts, coalesce(p_note, ''))
  on conflict (effective_from) do update set note = excluded.note
  returning id into the_split;

  delete from public.split_shares where split_id = the_split;

  insert into public.split_shares (split_id, user_id, percent)
  select the_split, (share ->> 'user_id')::uuid, (share ->> 'percent')::numeric
  from jsonb_array_elements(p_shares) as share;

  return the_split;
end;
$$;

revoke all on function public.save_split(date, text, jsonb, date) from public, anon;
grant execute on function public.save_split(date, text, jsonb, date) to authenticated;

-- The same clock for the rows that predate the column: a source created
-- at 9pm in New York belongs to that day, not to the next one in UTC.
update public.income_sources
set effective_from = (created_at at time zone 'America/New_York')::date
where effective_from > (created_at at time zone 'America/New_York')::date;

-- And no clock of its own: every insert says which day it starts.
alter table public.income_sources alter column effective_from drop default;
