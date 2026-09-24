-- REQ-21's hourly test notification has done its job: real Finances
-- reminders now use the same clock, vault secrets and sender
-- (20260924140000). Vin asked for it to stop on 2026-09-24. Only the
-- schedule goes; "Send test now" in the admin console stays, and so do
-- the vault's notify_url and notify_secret, which the reminders read.
-- Written so it does nothing if the job is already gone.
select cron.unschedule(jobid) from cron.job where jobname = 'hourly-test-notification';
