-- Finances action items and reminders (REQ-91, REQ-93, REQ-70).
--
-- Most items need nothing stored: they are worked out from the month's
-- bills, payments and balances each time, and clear themselves when the
-- data changes. Three things can't be worked out that way, so they get a
-- place here:
--   1. who entered each bill, so "numbers are ready" reaches only the
--      person who didn't;
--   2. items a person has seen or acknowledged ("numbers are ready" clears
--      when opened, "cash gap" when acknowledged);
--   3. which pushes already went, so the hourly job sends each one once.

-- 1. Who entered a bill. Rent the month pre-enters has no one.
alter table public.month_bills
  add column entered_by uuid references public.household_members (user_id) on delete set null;

grant update (entered_by) on public.month_bills to authenticated;

create or replace function public.enter_bill(p_month_bill uuid, p_amount numeric, p_personal_answer text)
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
  set amount = p_amount, personal_answer = p_personal_answer, entered_at = now(),
      entered_by = (select auth.uid())
  where id = p_month_bill;
  if not found then
    raise exception 'That bill is not in an open month'
      using errcode = 'no_data_found';
  end if;
end;
$$;

-- 2. Items seen or acknowledged, one row per person and item. The key
-- names the item and its month, e.g. "ready:2026-09-01". Each person
-- writes and reads only their own; nothing here is worth removing, and a
-- stray row only hides a note that was already read.
create table public.action_item_acks (
  user_id uuid not null default auth.uid()
    references public.household_members (user_id) on delete cascade,
  key text not null check (length(key) between 1 and 100),
  acked_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.action_item_acks enable row level security;
revoke all on public.action_item_acks from anon;

create policy "people read their own acknowledgements"
  on public.action_item_acks for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));

create policy "people acknowledge for themselves"
  on public.action_item_acks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_member()));

-- 3. Pushes already sent: one row per person and topic, e.g.
-- "ended:2026-09-01". Only the sending job, with the secret key, touches
-- it; signed-in people have no reason to.
create table public.finance_pushes (
  user_id uuid not null references public.household_members (user_id) on delete cascade,
  topic text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, topic)
);

alter table public.finance_pushes enable row level security;
revoke all on public.finance_pushes from anon, authenticated;

-- The notification log records Finances pushes beside the test ones.
alter table public.notification_log drop constraint notification_log_trigger_check;
alter table public.notification_log
  add constraint notification_log_trigger_check check (trigger in ('hourly', 'manual', 'finances'));

-- The hourly Finances job. Same clock and secret as the test notification
-- (20260919190000): the vault's notify_url gives the app's address, and
-- only its origin is kept, so this calls /api/notifications/finances on
-- the same server. The app decides what, if anything, is due.
select cron.schedule(
  'finance-reminders',
  -- Ten past every hour, clear of the test job and the nightly close.
  '10 * * * *',
  $job$
  select net.http_post(
    url := (
      select regexp_replace(decrypted_secret, '^(https?://[^/]+).*$', '\1')
        || '/api/notifications/finances'
      from vault.decrypted_secrets where name = 'notify_url'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization',
      'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from vault.decrypted_secrets where name = 'notify_url'
  ) and exists (
    select 1 from vault.decrypted_secrets where name = 'notify_secret'
  );
  $job$
);
