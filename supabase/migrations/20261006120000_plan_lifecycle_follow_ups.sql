-- Meal Plan lifecycle follow-ups (REQ-163), found while trying the first
-- migration (20261006110000) on the preview.
--
-- 1. Remember who pressed Start, so a second person who opens the
--    "Start this week's plan?" notification after the plan was started can be
--    told who started it.
-- 2. Run the schedule on the hour (it was twenty past, picked only to stay
--    clear of the Finances job), so the start question arrives at 11:00 AM
--    and 6:00 PM.

alter table public.meal_plans add column began_by uuid references auth.users (id) on delete set null;

create or replace function public.begin_meal_plan(p_plan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can start a plan'
      using errcode = 'insufficient_privilege';
  end if;
  update public.meal_plans set status = 'started', began_by = (select auth.uid())
   where id = p_plan and closed_at is null and not ahead and status = 'new';
end;
$$;

-- Same job, same name, same call: only the minute changes.
select cron.schedule(
  'meal-plan-schedule',
  '0 * * * *',
  $job$
  select net.http_post(
    url := (
      select regexp_replace(decrypted_secret, '^(https?://[^/]+).*$', '\1')
        || '/api/notifications/meal-plan'
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
