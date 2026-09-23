-- Follow-ups to closing a month, from review of #153.
--
-- 1. A closed month's record can't lose a person: removing a member who
--    appears on one is refused, like removing one with payments there.
-- 2. "Closed on its own" is its own flag, not read from an empty
--    closed_by, which removing the admin who closed a month would empty.
-- 3. The balance functions are for the database's own use (closing, the
--    nightly job); signed-in users read months through row-level
--    security instead.
-- 4. A month with no bills isn't squared, so it never closes itself.

alter table public.month_people
  drop constraint month_people_user_id_fkey,
  add constraint month_people_user_id_fkey
    foreign key (user_id) references public.household_members (user_id) on delete restrict;

alter table public.months add column closed_automatically boolean not null default false;

create or replace function public.close_month(p_month uuid, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_month public.months;
begin
  select * into the_month from public.months where id = p_month for update;
  if the_month.closed_at is not null then
    return;
  end if;

  insert into public.month_people (month_id, user_id, percent, outstanding)
  select p_month, b.user_id, b.percent, b.outstanding from public.month_balances(p_month) b;

  update public.months
  set closed_at = now(),
      closed_by = p_by,
      closed_automatically = p_by is null,
      split_from = (select s.effective_from from public.splits s
                    where s.effective_from <= the_month.starts_on
                    order by s.effective_from desc limit 1)
  where id = p_month;
end;
$$;

revoke all on function public.close_month(uuid, uuid) from public, anon, authenticated;

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
          or mb.amount <> coalesce((select sum(pay.amount) from public.payments pay
                                    where pay.month_bill_id = mb.id), 0)
        )
    )
    and not exists (select 1 from public.month_balances(p_month) b where b.outstanding <> 0);
$$;

revoke all on function public.month_balances(uuid) from public, anon, authenticated;
revoke all on function public.month_is_squared(uuid) from public, anon, authenticated;
