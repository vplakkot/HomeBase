-- REQ-22. One row per notification per device, so reliability can be
-- reviewed in the morning instead of by asking whether anyone's phone
-- buzzed. Written only by the sender, which runs with the secret key;
-- read only by an admin, which is who the requirement is for.

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  trigger text not null check (trigger in ('hourly', 'manual')),
  -- Whose notification it was. Leaving the household takes the log with
  -- it, the same as their devices.
  user_id uuid not null
    references public.household_members (user_id) on delete cascade,
  -- Which device, but NOT its push address. That address is precisely
  -- what lets anyone send to the phone, so the log keeps a fingerprint of
  -- it instead: enough to tell one device from another and to follow one
  -- device over time, never enough to send anything.
  device text not null,
  -- The secret handed to this one device inside this one message. The
  -- device sends it back to say it arrived. It proves the receipt came
  -- from the device the message actually reached, which nothing else can:
  -- a delivery report arrives with no session, because a notification can
  -- land on a phone whose owner is signed out.
  receipt_token text not null unique,
  delivered_at timestamptz,
  tapped_at timestamptz,
  -- The sender's own outcome. A send the push service refused is still a
  -- send that happened, and it should show as one.
  accepted boolean not null default true,
  -- Why it was refused, when it was: the push service's status code.
  failure_code integer
);

-- The log is read newest-first, over a window of days.
create index notification_log_sent_at_idx
  on public.notification_log (sent_at desc);

-- Receipts arrive by token and must find their row in one hop.
create unique index notification_log_receipt_token_idx
  on public.notification_log (receipt_token);

alter table public.notification_log enable row level security;

-- Admins read it; that is the requirement. Note this is the first place
-- an admin can see anything about another member's notifications: REQ-16
-- and REQ-20 deliberately kept switches and devices private even from
-- admins. What is exposed here is narrower than either — when a message
-- was sent and whether it arrived, against a device fingerprint rather
-- than an address — and the requirement asks for it by name.
create policy "Admins read the notification log"
  on public.notification_log for select to authenticated
  using (
    public.is_member() and (select public.has_permission('manage_members'))
  );

-- No insert, update or delete policy at all. Only the sender and the
-- receipt address write here, and both use the secret key, which
-- bypasses these rules. Nobody signed in can write to the log, so nobody
-- can fake a delivery.

-- Every policy above is `to authenticated`; this is the second layer.
revoke all on public.notification_log from anon;

-- Entries older than 30 days go, as the requirement asks. pg_cron is
-- already here from REQ-21. Deliberately not on the hour, so it never
-- races the hourly send.
select cron.schedule(
  'delete-old-notification-log',
  -- Twenty past four, once a day.
  '20 4 * * *',
  $job$
  delete from public.notification_log
  where sent_at < now() - interval '30 days';
  $job$
);
