-- The split gets a date, and income sources get a history (#132).
--
-- Vin: "I should be able to change % mid-year as salary changes ... doesn't
-- mean change everything backwards." So a split is no longer one row per
-- budget year: it is a percentage set that starts on a given month and
-- stays in force until a later one starts. A month uses the split in force
-- when it opens, which is what keeps closed months as they were (REQ-52).
-- The budget year stays as the April-to-March frame the March review works
-- in (REQ-69); it is worked out from the calendar, not stored.

create table public.splits (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique check (extract(day from effective_from) = 1),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.split_shares (
  split_id uuid not null references public.splits (id) on delete cascade,
  user_id uuid not null references public.household_members (user_id) on delete cascade,
  percent numeric(5, 2) not null check (percent >= 0 and percent <= 100),
  primary key (split_id, user_id)
);

-- Carry over what the household already saved: a budget year starting in
-- April becomes a split effective that April.
insert into public.splits (id, effective_from, note, created_at)
select id, make_date(start_year, 4, 1), note, created_at from public.budget_years;

insert into public.split_shares (split_id, user_id, percent)
select budget_year_id, user_id, percent from public.budget_year_shares;

drop function public.save_budget_year(integer, text, jsonb);
drop table public.budget_year_shares;
drop table public.budget_years;
drop function public.check_budget_year_total();

alter table public.splits enable row level security;
alter table public.split_shares enable row level security;

revoke all on public.splits from anon;
revoke all on public.split_shares from anon;

create policy "members read splits"
  on public.splits for select to authenticated
  using ((select public.is_member()));

create policy "manage splits"
  on public.splits for all to authenticated
  using ((select public.has_permission('manage_budget')))
  with check ((select public.has_permission('manage_budget')));

create policy "members read split shares"
  on public.split_shares for select to authenticated
  using ((select public.is_member()));

create policy "manage split shares"
  on public.split_shares for all to authenticated
  using ((select public.has_permission('manage_budget')))
  with check ((select public.has_permission('manage_budget')));

-- Same rule as before, on the new tables: a split's percentages must total
-- 100, checked when the transaction commits so every share is counted
-- (docs/lessons/19-rules-across-rows.md). Deletes aren't checked.
create function public.check_split_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_split uuid;
  total numeric;
begin
  if tg_table_name = 'splits' then
    the_split := new.id;
  else
    the_split := new.split_id;
  end if;

  select coalesce(sum(percent), 0) into total
  from public.split_shares
  where split_id = the_split;

  if total <> 100 then
    raise exception 'The percentages must total 100; these total %', total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

revoke all on function public.check_split_total() from public, anon, authenticated;

create constraint trigger split_total_on_save
  after insert or update on public.splits
  deferrable initially deferred
  for each row execute function public.check_split_total();

create constraint trigger split_total_on_share
  after insert or update on public.split_shares
  deferrable initially deferred
  for each row execute function public.check_split_total();

create function public.save_split(
  p_effective_from date,
  p_note text,
  p_shares jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  the_split uuid;
begin
  insert into public.splits (effective_from, note)
  values (date_trunc('month', p_effective_from)::date, coalesce(p_note, ''))
  on conflict (effective_from) do update set note = excluded.note
  returning id into the_split;

  delete from public.split_shares where split_id = the_split;

  insert into public.split_shares (split_id, user_id, percent)
  select the_split, (share ->> 'user_id')::uuid, (share ->> 'percent')::numeric
  from jsonb_array_elements(p_shares) as share;

  return the_split;
end;
$$;

revoke all on function public.save_split(date, text, jsonb) from public, anon;
grant execute on function public.save_split(date, text, jsonb) to authenticated;

-- An income source now has a life: it starts on a day and may end on one.
-- Changing one doesn't rewrite it — it ends the old one today and starts a
-- new one, so paydays already past keep the amount they were paid at.
alter table public.income_sources
  add column effective_from date not null default current_date,
  add column ended_on date;

create function public.change_income_source(
  p_id uuid,
  p_name text,
  p_owner_id uuid,
  p_net_amount numeric,
  p_cadence text,
  p_anchor_date date
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
  set ended_on = current_date
  where id = p_id and ended_on is null;

  if not found then
    raise exception 'That income source is not in force';
  end if;

  insert into public.income_sources (name, owner_id, net_amount, cadence, anchor_date, effective_from)
  values (p_name, p_owner_id, p_net_amount, p_cadence, p_anchor_date, current_date)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.change_income_source(uuid, text, uuid, numeric, text, date) from public, anon;
grant execute on function public.change_income_source(uuid, text, uuid, numeric, text, date) to authenticated;
