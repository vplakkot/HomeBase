-- REQ-21. The clock for the hourly test notification lives in the database,
-- because Vercel's free plan only allows a daily job. pg_cron keeps the
-- time; pg_net lets the database call the app's own address, which does the
-- sending.
--
-- Neither the address nor the shared secret is in this file. Both live in
-- Supabase's vault under the names below and are read each time the job
-- runs, so they can change without a migration and never reach git. Until
-- they exist the job runs and does nothing, rather than failing hourly.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'hourly-test-notification',
  -- On the hour, around the clock.
  '0 * * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret from vault.decrypted_secrets where name = 'notify_url'
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
