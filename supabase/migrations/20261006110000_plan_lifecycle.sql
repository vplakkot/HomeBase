-- Meal Plan: plan lifecycle, new / started / closed (REQ-163).
--
-- A plan is new until someone starts it, started until it is closed, then
-- closed. Closing counts every dish as cooked unless it was marked "Didn't
-- cook this". A schedule closes plans nobody closed, slides plans nobody
-- started, and asks us to start them (the app does that part; this adds the
-- hourly call). Existing plans: closed stay closed, the plan running is
-- started, the plan ahead is new.
--
-- Written so the live app keeps working until the new code is live: the old
-- `carry_over` and `cooked` columns stay (closing treats "carry over" the same
-- as "didn't cook"), and a member's Close works on any open plan, as it
-- always did. A plan the old app creates is new, and the old app has no Start
-- button for it; it can still close it, and the new code, once live, shows it
-- with a Start button.

alter table public.meal_plans
  add column status text not null default 'started' check (status in ('new', 'started', 'closed')),
  add column start_prompted_on date;

update public.meal_plans
   set status = case when closed_at is not null then 'closed' when ahead then 'new' else 'started' end;

alter table public.meal_plan_recipes add column didnt_cook boolean not null default false;
update public.meal_plan_recipes set didnt_cook = true where carry_over;

-- Dishes the last closed plan carried over are proposed first, as they were,
-- but through the one list the closing cards use now. Not those already in an
-- open plan.
insert into public.meal_plan_proposed_next (recipe_id, reason)
select distinct e.recipe_id, 'didnt_cook'
  from public.meal_plan_recipes e
 where e.carry_over
   and e.recipe_id is not null
   and e.plan_id = (select id from public.meal_plans where closed_at is not null order by closed_at desc limit 1)
   and not exists (
     select 1
       from public.meal_plan_recipes o
       join public.meal_plans p on p.id = o.plan_id
      where o.recipe_id = e.recipe_id and p.closed_at is null)
on conflict (recipe_id) do nothing;

-- The log records the plan-start notification beside the others.
alter table public.notification_log drop constraint notification_log_trigger_check;
alter table public.notification_log
  add constraint notification_log_trigger_check check (trigger in ('hourly', 'manual', 'finances', 'meal-plan'));

-- Start a plan (REQ-115). With a current plan open it becomes the plan
-- ahead (REQ-162). Every plan we create starts new: someone presses Start.
create or replace function public.start_meal_plan(p_starts_on date, p_starts_meal text default 'dinner')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_plan uuid;
  new_plan uuid;
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can start a plan'
      using errcode = 'insufficient_privilege';
  end if;
  select id into current_plan from public.meal_plans where closed_at is null and not ahead for update;
  insert into public.meal_plans (starts_on, starts_meal, started_by, ahead, status)
  values (p_starts_on, p_starts_meal, (select auth.uid()), current_plan is not null, 'new')
  returning id into new_plan;
  return new_plan;
end;
$$;

-- Press Start on the plan we're on.
create function public.begin_meal_plan(p_plan uuid)
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
  update public.meal_plans set status = 'started'
   where id = p_plan and closed_at is null and not ahead and status = 'new';
end;
$$;

revoke all on function public.begin_meal_plan(uuid) from public, anon;
grant execute on function public.begin_meal_plan(uuid) to authenticated;

-- Closing. The schedule (nobody signed in) passes `p_only_started`, so it
-- never closes a plan nobody started; a member's Close below doesn't. Every dish counts as cooked unless it was
-- marked "Didn't cook this" (or carried over, which the old app wrote);
-- each of us is asked to rate a dish cooked for the first time. When the
-- plan we're on closes, the plan ahead becomes current, and is new.
create function public.close_meal_plan_system(p_plan uuid, p_only_started boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.meal_plans where id = p_plan and closed_at is null and (status = 'started' or not p_only_started) for update;
  if not found then
    return;
  end if;
  insert into public.recipe_rating_prompts (recipe_id, user_id, plan_id)
  select mpr.recipe_id, hm.user_id, p_plan
    from public.meal_plan_recipes mpr
    cross join public.household_members hm
   where mpr.plan_id = p_plan
     and mpr.recipe_id is not null
     and not (mpr.didnt_cook or mpr.carry_over)
     and not exists (
       select 1
         from public.meal_plan_recipes earlier
         join public.meal_plans p on p.id = earlier.plan_id
        where earlier.recipe_id = mpr.recipe_id
          and earlier.plan_id <> p_plan
          and earlier.cooked
          and p.closed_at is not null)
     and not exists (
       select 1 from public.recipe_ratings rr
        where rr.recipe_id = mpr.recipe_id and rr.user_id = hm.user_id)
  on conflict do nothing;
  update public.meal_plan_recipes set cooked = not (didnt_cook or carry_over) where plan_id = p_plan;
  update public.meal_plans set closed_at = now(), status = 'closed' where id = p_plan;
  update public.meal_plans set ahead = false where closed_at is null and ahead;
end;
$$;

revoke all on function public.close_meal_plan_system(uuid, boolean) from public, anon, authenticated;
grant execute on function public.close_meal_plan_system(uuid, boolean) to service_role;

-- Either of us closes the plan we're on, any time (the new app offers Close
-- on a started plan; the old one offered it on any).
create or replace function public.close_meal_plan(p_plan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can close a plan'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.close_meal_plan_system(p_plan, false);
end;
$$;

-- Nothing is stuck: the last plan closed by mistake opens again, started.
create or replace function public.reopen_meal_plan(p_plan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can reopen a plan'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.meal_plans where closed_at is null) then
    raise exception 'Another plan is open'
      using errcode = 'unique_violation';
  end if;
  if p_plan is distinct from (select id from public.meal_plans where closed_at is not null order by closed_at desc limit 1) then
    raise exception 'Only the last plan closed can be reopened'
      using errcode = 'check_violation';
  end if;
  delete from public.recipe_rating_prompts where plan_id = p_plan;
  update public.meal_plans set closed_at = null, status = 'started' where id = p_plan;
end;
$$;

-- "Didn't cook this" on a dish. On a closed plan it changes what counted:
-- the dish stops counting as cooked and its unanswered rating questions go;
-- taking the mark back counts it again and asks the first-time question
-- again. A closed plan's rows can't be changed by the row rules, so this
-- runs with the right to, after checking the caller is a member.
create function public.set_didnt_cook(p_entry uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_recipe uuid;
  v_closed boolean;
begin
  if not public.has_permission('use_modules') then
    raise exception 'Only a household member can change a plan'
      using errcode = 'insufficient_privilege';
  end if;
  select e.plan_id, e.recipe_id, p.closed_at is not null
    into v_plan, v_recipe, v_closed
    from public.meal_plan_recipes e
    join public.meal_plans p on p.id = e.plan_id
   where e.id = p_entry
     for update of e;
  if not found or v_recipe is null then
    return;
  end if;
  update public.meal_plan_recipes
     set didnt_cook = p_value,
         carry_over = false,
         cooked = case when v_closed then not p_value else cooked end
   where id = p_entry;
  if not v_closed then
    return;
  end if;
  if p_value then
    delete from public.recipe_rating_prompts where recipe_id = v_recipe and plan_id = v_plan;
  else
    insert into public.recipe_rating_prompts (recipe_id, user_id, plan_id)
    select v_recipe, hm.user_id, v_plan
      from public.household_members hm
     where not exists (
             select 1
               from public.meal_plan_recipes earlier
               join public.meal_plans p on p.id = earlier.plan_id
              where earlier.recipe_id = v_recipe
                and earlier.plan_id <> v_plan
                and earlier.cooked
                and p.closed_at is not null)
       and not exists (
             select 1 from public.recipe_ratings rr
              where rr.recipe_id = v_recipe and rr.user_id = hm.user_id)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.set_didnt_cook(uuid, boolean) from public, anon;
grant execute on function public.set_didnt_cook(uuid, boolean) to authenticated;

-- The hourly call. Same clock and secret as the Finances reminders: the
-- vault's notify_url gives the app's address, and this calls
-- /api/notifications/meal-plan on the same server. The app decides what,
-- if anything, is due: closing plans nobody closed, sliding plans nobody
-- started, and asking us to start one.
select cron.schedule(
  'meal-plan-schedule',
  -- Twenty past every hour, clear of the Finances job at ten past.
  '20 * * * *',
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
