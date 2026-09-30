-- Payments: a date of their own, and no ceiling (Vin, 2026-09-29).
--
-- 1. A payment says the day it was paid, like a one-time payment does.
--    Logging one for a past month needs a date in that month, and the
--    day it was typed in says nothing about when the money moved. Rows
--    already logged get the day they were logged, on the household's
--    clock.
-- 2. A bill's payments may come to more than the bill. Money is
--    sometimes sent over on purpose or by mistake, and the app should
--    record what happened rather than refuse it. The month's sums
--    already read the surplus as a credit ("below zero is a credit").
--    This also drops the guard on lowering or clearing a bill's amount
--    below what's been paid, which is the same rule at the other door.
alter table public.payments add column paid_on date;
update public.payments set paid_on = (created_at at time zone 'America/New_York')::date;
alter table public.payments alter column paid_on set not null;
alter table public.payments alter column paid_on set default (timezone('America/New_York', now()))::date;
grant update (paid_on) on public.payments to authenticated;

drop trigger payments_fit_the_bill on public.payments;
drop trigger bill_holds_its_payments on public.month_bills;
drop function public.check_bill_payments();

-- 3. A month paid more than in full still squares (Vin, 2026-09-29):
--    every bill covered (paid at least its amount) and nobody owing.
--    Same function as before, with `<>` and `<> 0` loosened to `>` and
--    `> 0`, so the nightly close matches isSquared() in the app.
create or replace function public.month_is_squared(p_month uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.month_balances(p_month))
    and exists (select 1 from public.month_bills mb where mb.month_id = p_month)
    and not exists (
      select 1 from public.month_bills mb
      where mb.month_id = p_month
        and (
          mb.amount is null
          or (mb.kind = 'card' and mb.personal_answer is null)
          or (mb.kind = 'card' and mb.personal_answer = 'some'
              and not exists (select 1 from public.personal_charges pc where pc.month_bill_id = mb.id))
          or mb.amount > coalesce((select sum(pay.amount) from public.payments pay
                                   where pay.month_bill_id = mb.id), 0)
        )
    )
    and not exists (select 1 from public.month_balances(p_month) b where b.outstanding > 0);
$$;

revoke all on function public.month_is_squared(uuid) from public, anon, authenticated;
