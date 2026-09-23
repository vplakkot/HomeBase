-- Who owes what (REQ-57, REQ-58), and the date a one-time payment was
-- paid (REQ-55, as revised by Vin on 2026-09-23).
--
-- A payment is money one person sent to one of the month's bills. It
-- goes against the month's own copy of the bill, so it belongs to that
-- month. Like entering, logging is shared: any member with the
-- use_modules key logs, edits or deletes a payment for either person.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  month_bill_id uuid not null references public.month_bills (id) on delete cascade,
  payer_id uuid not null references public.household_members (user_id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index payments_month_bill_id_idx on public.payments (month_bill_id);

alter table public.payments enable row level security;
revoke all on public.payments from anon;

create policy "members read payments"
  on public.payments for select to authenticated
  using ((select public.is_member()));

create policy "members log payments"
  on public.payments for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members change payments"
  on public.payments for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

create policy "members delete payments"
  on public.payments for delete to authenticated
  using ((select public.has_permission('use_modules')));

revoke update on public.payments from authenticated;
grant update (month_bill_id, payer_id, amount) on public.payments to authenticated;

-- A bill's payments can't come to more than the bill (REQ-57). A bill
-- with no amount entered yet counts as $0, so nothing can be paid toward
-- it. Checked when a payment is logged or changed, and when the bill's
-- amount is changed or cleared, so neither door gets round it.
create function public.check_bill_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_bill public.month_bills;
  paid numeric;
begin
  -- Locking the bill makes two payments logged at the same moment take
  -- turns, so the second one sees the first when it adds them up.
  if tg_table_name = 'payments' then
    select * into the_bill from public.month_bills where id = new.month_bill_id for update;
  else
    the_bill := new;
  end if;

  select coalesce(sum(amount), 0) into paid
  from public.payments
  where month_bill_id = the_bill.id;

  if paid > coalesce(the_bill.amount, 0) then
    raise exception 'The payments come to more than the bill'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke all on function public.check_bill_payments() from public, anon, authenticated;

create constraint trigger payments_fit_the_bill
  after insert or update on public.payments
  for each row execute function public.check_bill_payments();

create constraint trigger bill_holds_its_payments
  after update on public.month_bills
  for each row execute function public.check_bill_payments();

-- One-time payments are always already paid; this is the day they were.
-- Rows logged before today get the day they were logged, on the
-- household's clock, kept inside their own month (one logged on 1 October
-- for September gets 30 September).
alter table public.direct_payments add column paid_on date;
update public.direct_payments dp
set paid_on = least(
  greatest((dp.created_at at time zone 'America/New_York')::date, m.starts_on),
  (m.starts_on + interval '1 month' - interval '1 day')::date
)
from public.months m
where m.id = dp.month_id;
alter table public.direct_payments alter column paid_on set not null;

-- save_bill again, with one change: switching a bill between rent and
-- "other" keeps the open month's amount. Only a switch to or from a card
-- starts the entry again, because only a card has the personal-charges
-- answer.
create or replace function public.save_bill(
  p_id uuid,
  p_name text,
  p_kind text,
  p_due_day integer,
  p_apply boolean,
  p_today date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_bill uuid := p_id;
  the_month uuid;
  copy public.month_bills;
begin
  if not public.has_permission('manage_budget') then
    raise exception 'Only an admin changes the bill list'
      using errcode = 'insufficient_privilege';
  end if;

  if the_bill is null then
    insert into public.bills (name, kind, due_day)
    values (p_name, p_kind, p_due_day)
    returning id into the_bill;
  else
    update public.bills set name = p_name, kind = p_kind, due_day = p_due_day
    where id = the_bill;
    if not found then
      raise exception 'That bill is no longer in the list' using errcode = 'no_data_found';
    end if;
  end if;

  if not p_apply then
    return the_bill;
  end if;

  select id into the_month from public.months
  where starts_on = date_trunc('month', p_today)::date;
  if the_month is null then
    return the_bill;
  end if;

  select * into copy from public.month_bills
  where month_id = the_month and bill_id = the_bill;
  if copy.id is null then
    insert into public.month_bills (month_id, bill_id, name, kind, due_day)
    values (the_month, the_bill, p_name, p_kind, p_due_day);
  elsif (copy.kind = 'card') <> (p_kind = 'card') then
    delete from public.personal_charges where month_bill_id = copy.id;
    update public.month_bills
    set name = p_name, kind = p_kind, due_day = p_due_day,
        amount = null, personal_answer = null, entered_at = null
    where id = copy.id;
  else
    update public.month_bills set name = p_name, kind = p_kind, due_day = p_due_day
    where id = copy.id;
  end if;
  return the_bill;
end;
$$;
