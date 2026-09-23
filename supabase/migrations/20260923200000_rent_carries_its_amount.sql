-- A rent bill carries its monthly amount (Vin, 2026-09-23; changes
-- REQ-94). Rent is the same every month, so the Budget year asks for it
-- once, and each month opened starts with rent already entered. Monthly
-- entry can still change a month's figure, and the admin can change the
-- amount in the Budget year later.

alter table public.bills add column amount numeric(12, 2) check (amount >= 0);

-- Only rent carries an amount. A new or changed rent bill must have one;
-- NOT VALID leaves a rent bill saved before today alone until it is next
-- saved, when the form asks for the amount.
alter table public.bills
  add constraint bills_only_rent_has_an_amount check (kind = 'rent' or amount is null);
alter table public.bills
  add constraint bills_rent_has_an_amount check (kind <> 'rent' or amount is not null) not valid;

-- open_month again, with one change: rent's copy starts with the bill's
-- amount, already entered.
create or replace function public.open_month(p_month date, p_today date)
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
  insert into public.month_bills (month_id, bill_id, name, kind, due_day, amount, entered_at)
  select the_month, id, name, kind, due_day, amount,
         case when amount is not null then now() end
  from public.bills;
  return the_month;
end;
$$;

-- save_bill takes the amount now, so the old one goes. With the tick, a
-- changed rent amount also becomes the open month's figure for it
-- (refused, like any lower figure, if more than that is already paid
-- toward it). Saving rent without changing its amount — a rename, say —
-- leaves a figure Monthly entry changed for this month alone.
drop function public.save_bill(uuid, text, text, integer, boolean, date);

create function public.save_bill(
  p_id uuid,
  p_name text,
  p_kind text,
  p_due_day integer,
  p_amount numeric,
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
  rent numeric := case when p_kind = 'rent' then p_amount end;
  was_rent numeric;
begin
  if not public.has_permission('manage_budget') then
    raise exception 'Only an admin changes the bill list'
      using errcode = 'insufficient_privilege';
  end if;

  if the_bill is null then
    insert into public.bills (name, kind, due_day, amount)
    values (p_name, p_kind, p_due_day, rent)
    returning id into the_bill;
  else
    select amount into was_rent from public.bills where id = the_bill;
    update public.bills set name = p_name, kind = p_kind, due_day = p_due_day, amount = rent
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
    insert into public.month_bills (month_id, bill_id, name, kind, due_day, amount, entered_at)
    values (the_month, the_bill, p_name, p_kind, p_due_day, rent,
            case when rent is not null then now() end);
  elsif (copy.kind = 'card') <> (p_kind = 'card') then
    delete from public.personal_charges where month_bill_id = copy.id;
    update public.month_bills
    set name = p_name, kind = p_kind, due_day = p_due_day,
        amount = rent, personal_answer = null,
        entered_at = case when rent is not null then now() end
    where id = copy.id;
  elsif rent is not null and (copy.kind <> 'rent' or rent is distinct from was_rent) then
    update public.month_bills
    set name = p_name, kind = p_kind, due_day = p_due_day, amount = rent, entered_at = now()
    where id = copy.id;
  else
    update public.month_bills set name = p_name, kind = p_kind, due_day = p_due_day
    where id = copy.id;
  end if;
  return the_bill;
end;
$$;

revoke all on function public.save_bill(uuid, text, text, integer, numeric, boolean, date) from public, anon;
grant execute on function public.save_bill(uuid, text, text, integer, numeric, boolean, date) to authenticated;
