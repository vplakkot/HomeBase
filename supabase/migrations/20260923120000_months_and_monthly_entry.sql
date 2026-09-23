-- Monthly entry (REQ-53, REQ-54, REQ-55, and REQ-94's month criteria).
--
-- A month is opened once. Opening it copies the household's bill list
-- into it, so a bill changed or removed later only reaches months opened
-- after that (REQ-94): the copy is the month's own list, like a photocopy
-- of the list taken on the day.
--
-- Entering is shared, not per person (REQ-53): any member with the
-- use_modules key enters bills, personal charges and direct payments, and
-- everyone reads them. Closing a month, and what it locks, comes later.

create table public.months (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null unique check (extract(day from starts_on) = 1),
  opened_at timestamptz not null default now()
);

-- A card statement can't be saved without answering whether personal
-- charges sit inside it (REQ-54): the answer is 'none' or 'some'. Rent
-- and other bills are never asked.
create table public.month_bills (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.months (id) on delete cascade,
  bill_id uuid references public.bills (id) on delete set null,
  name text not null,
  kind text not null check (kind in ('rent', 'card', 'other')),
  due_day integer not null check (due_day between 1 and 31),
  amount numeric(12, 2) check (amount >= 0),
  personal_answer text check (personal_answer in ('none', 'some')),
  entered_at timestamptz,
  unique (month_id, bill_id),
  check (kind = 'card' or personal_answer is null),
  check (kind <> 'card' or amount is null or personal_answer is not null)
);

-- A charge still inside a card statement that belongs to one person: it
-- leaves the shared base and is theirs in full.
create table public.personal_charges (
  id uuid primary key default gen_random_uuid(),
  month_bill_id uuid not null references public.month_bills (id) on delete cascade,
  owner_id uuid not null references public.household_members (user_id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

-- Shared spend one person paid outside the tracked cards: it joins the
-- shared base, and the payer has already paid it.
create table public.direct_payments (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.months (id) on delete cascade,
  payer_id uuid not null references public.household_members (user_id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null check (length(btrim(note)) > 0),
  created_at timestamptz not null default now()
);

alter table public.months enable row level security;
alter table public.month_bills enable row level security;
alter table public.personal_charges enable row level security;
alter table public.direct_payments enable row level security;

revoke all on public.months from anon;
revoke all on public.month_bills from anon;
revoke all on public.personal_charges from anon;
revoke all on public.direct_payments from anon;

create policy "members read months"
  on public.months for select to authenticated
  using ((select public.is_member()));

create policy "members read month bills"
  on public.month_bills for select to authenticated
  using ((select public.is_member()));

-- A month's bills arrive only through open_month below. Afterwards a
-- member fills in the amount and the personal-charges answer; the name,
-- kind and due day stay as they were copied.
create policy "members enter month bills"
  on public.month_bills for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

revoke update on public.month_bills from authenticated;
grant update (amount, personal_answer, entered_at) on public.month_bills to authenticated;

create policy "members read personal charges"
  on public.personal_charges for select to authenticated
  using ((select public.is_member()));

create policy "members add personal charges"
  on public.personal_charges for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members remove personal charges"
  on public.personal_charges for delete to authenticated
  using ((select public.has_permission('use_modules')));

create policy "members read direct payments"
  on public.direct_payments for select to authenticated
  using ((select public.is_member()));

create policy "members add direct payments"
  on public.direct_payments for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members remove direct payments"
  on public.direct_payments for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- Personal charges only come out of a card statement whose answer was
-- 'some', and together they can't be more than the statement. Checked
-- when a charge is added and when the statement is changed, so neither
-- door gets round it.
create function public.check_personal_charges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_bill public.month_bills;
  total numeric;
begin
  if tg_table_name = 'personal_charges' then
    select * into the_bill from public.month_bills where id = new.month_bill_id;
  else
    the_bill := new;
  end if;

  select coalesce(sum(amount), 0) into total
  from public.personal_charges
  where month_bill_id = the_bill.id;

  if total > 0 and (the_bill.kind <> 'card' or the_bill.personal_answer is distinct from 'some') then
    raise exception 'Personal charges belong to a card statement that has some'
      using errcode = 'check_violation';
  end if;
  if total > coalesce(the_bill.amount, 0) then
    raise exception 'The personal charges come to more than the statement'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke all on function public.check_personal_charges() from public, anon, authenticated;

create constraint trigger personal_charges_fit_the_statement
  after insert or update on public.personal_charges
  for each row execute function public.check_personal_charges();

create constraint trigger statement_holds_its_personal_charges
  after update on public.month_bills
  for each row execute function public.check_personal_charges();

-- Opens the month p_today falls in, copying the bill list into it. Only
-- the month now running can be opened: a later one hasn't started, and
-- an earlier one would be filled from today's list rather than its own.
-- Opening a month twice does nothing and returns the same month. The day
-- is passed in because the server's clock isn't the household's
-- (docs/lessons/20-rows-with-a-life.md).
create function public.open_month(p_month date, p_today date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_month uuid;
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

  select id into the_month from public.months where starts_on = starts;
  if the_month is not null then
    return the_month;
  end if;

  insert into public.months (starts_on) values (starts) returning id into the_month;
  insert into public.month_bills (month_id, bill_id, name, kind, due_day)
  select the_month, id, name, kind, due_day from public.bills;
  return the_month;
end;
$$;

revoke all on function public.open_month(date, date) from public, anon;
grant execute on function public.open_month(date, date) to authenticated;

-- Entering a statement, or changing it. Answering 'none' clears any
-- charges declared earlier, so the answer and the list can't disagree.
create function public.enter_bill(p_month_bill uuid, p_amount numeric, p_personal_answer text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_personal_answer is distinct from 'some' then
    delete from public.personal_charges where month_bill_id = p_month_bill;
  end if;
  update public.month_bills
  set amount = p_amount, personal_answer = p_personal_answer, entered_at = now()
  where id = p_month_bill;
  if not found then
    raise exception 'That bill is not in an open month'
      using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.enter_bill(uuid, numeric, text) from public, anon;
grant execute on function public.enter_bill(uuid, numeric, text) to authenticated;
