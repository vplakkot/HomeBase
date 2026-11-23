-- Pets notifications (REQ-190, REQ-192), and the three diet fields REQ-188
-- asked for that the first build left out: when a home-cooked batch runs
-- out, logging a new batch, and a start date other than today.

-- REQ-188: when a home-cooked batch is expected to run out.
alter table public.pet_diets add column food_runs_out_on date;
alter table public.pet_diets
  add constraint pet_diets_runs_out_after_start check (food_runs_out_on is null or food_runs_out_on >= started_on);

-- Date-based reminders already sent, one row per reminder, so a reminder
-- goes out once however often the job runs. The topic names the reminder
-- ("vaccine-soon:<vaccine row>"). Written by the job with the secret key.
create table public.pet_pushes (
  topic text primary key,
  sent_at timestamptz not null default now()
);
alter table public.pet_pushes enable row level security;
revoke all on public.pet_pushes from anon, authenticated;

-- A diet change waits here until nobody has touched the pet's diet for five
-- minutes, so several quick edits send one message with the final values.
-- before_diet is the diet as it stood before the first edit (null if there
-- was none): the message is worked out from it and the diet at send time.
create table public.pet_diet_pending (
  pet_id uuid primary key references public.pets (id) on delete cascade,
  -- Who made the latest edit; they are not told about their own change.
  actor uuid,
  before_diet jsonb,
  last_edit_at timestamptz not null default now()
);
alter table public.pet_diet_pending enable row level security;
revoke all on public.pet_diet_pending from anon, authenticated;

-- The notification log records Pets pushes beside the others.
alter table public.notification_log drop constraint notification_log_trigger_check;
alter table public.notification_log
  add constraint notification_log_trigger_check check (trigger in ('hourly', 'manual', 'finances', 'meal-plan', 'pets'));

-- The Pets job, every five minutes: it sends diet changes that have been
-- quiet for five minutes, and the day's due reminders. Same clock and secret
-- as the other jobs (20260924140000); the app decides what, if anything, is due.
select cron.schedule(
  'pet-notifications',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (
      select regexp_replace(decrypted_secret, '^(https?://[^/]+).*$', '\1')
        || '/api/notifications/pets'
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
