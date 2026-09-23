-- REQ-94, revised by Vin on 2026-09-23: a bill added, changed or removed
-- while the month now running is open asks whether that month takes the
-- change too. Past months never do: they keep the copy they were opened
-- with.
--
-- Both functions check the manage_budget key themselves and run as the
-- owner, because a member may only fill in a month bill's amount, never
-- its name, type or due day (the column grants in the previous
-- migration). The day is passed in from householdToday().

-- Adds a bill (p_id null) or changes one, and with p_apply also brings
-- the open month's copy in line. A change of type starts that month's
-- entry for it again, since a card's personal-charges answer means
-- nothing on rent.
create function public.save_bill(
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
  elsif copy.kind <> p_kind then
    delete from public.personal_charges where month_bill_id = copy.id;
    update public.month_bills
    set name = p_name, kind = p_kind, due_day = p_due_day,
        amount = null, personal_answer = null, entered_at = null
    where id = copy.id;
  else
    update public.month_bills set name = p_name, due_day = p_due_day
    where id = copy.id;
  end if;
  return the_bill;
end;
$$;

revoke all on function public.save_bill(uuid, text, text, integer, boolean, date) from public, anon;
grant execute on function public.save_bill(uuid, text, text, integer, boolean, date) to authenticated;

-- Retires a bill: later months no longer get it. With p_apply, the open
-- month stops waiting for it — if nothing was entered it becomes $0 (and
-- "no personal charges" for a card), so nothing is deleted and the month
-- can still be complete. An amount already entered stays as it is.
create function public.remove_bill(p_id uuid, p_apply boolean, p_today date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('manage_budget') then
    raise exception 'Only an admin changes the bill list'
      using errcode = 'insufficient_privilege';
  end if;

  if p_apply then
    update public.month_bills mb
    set amount = 0,
        personal_answer = case when mb.kind = 'card' then 'none' end,
        entered_at = now()
    from public.months m
    where m.id = mb.month_id
      and m.starts_on = date_trunc('month', p_today)::date
      and mb.bill_id = p_id
      and mb.amount is null;
  end if;

  delete from public.bills where id = p_id;
end;
$$;

revoke all on function public.remove_bill(uuid, boolean, date) from public, anon;
grant execute on function public.remove_bill(uuid, boolean, date) to authenticated;
