-- Meal Plan: a plan is a run of meals (REQ-168).
--
-- Until now a plan was an ordered list and the meal each entry landed on
-- was worked out by counting (`position` and `servings`). From here each
-- entry is written onto a meal of its own: a day, lunch or dinner, and a
-- size of 1 or 2 meals. A plan also remembers whether it starts at lunch
-- or dinner and which of its days are a Day off.
--
-- Shaped for later (REQ-168 design note, not built): where an entry sits
-- (day, meal, size) lives on the entry itself and says nothing about its
-- recipe, and nothing here makes a meal unique by recipe. A later change
-- can give one entry several recipes plus a "served with" note by moving
-- `recipe_id` to a child table, and the only rule to relax is the "two
-- entries on one meal" refusal in `set_plan_layout` (and the app's own
-- check beside it).
--
-- This migration only ADDS and fills. The old `position` and `servings`
-- columns stay until a later migration, once the new code is live: a
-- migration reaches Supabase before the code reaches main, so dropping
-- them here would break the running app in between.

alter table public.meal_plans
  add column starts_meal text not null default 'dinner' check (starts_meal in ('lunch', 'dinner'));

alter table public.meal_plan_recipes
  add column meal_on date,
  add column meal text check (meal in ('lunch', 'dinner')),
  add column meals integer check (meals in (1, 2)),
  add constraint meal_plan_entry_sits_on_a_whole_meal
    check ((meal_on is null) = (meal is null) and (meal is null) = (meals is null)),
  add constraint eating_out_is_one_dinner
    check (not eating_out or meal is null or (meal = 'dinner' and meals = 1));

-- A Day off turns a weekday into a weekend day for the plan it's marked in
-- (a 2-meal dish may start at its lunch). Marked by hand, never loaded
-- from a calendar.
create table public.meal_plan_days_off (
  plan_id uuid not null references public.meal_plans (id) on delete cascade,
  day date not null,
  primary key (plan_id, day)
);

alter table public.meal_plan_days_off enable row level security;
revoke all on public.meal_plan_days_off from anon;

create policy "members read days off"
  on public.meal_plan_days_off for select to authenticated
  using ((select public.is_member()));

create policy "members mark days off"
  on public.meal_plan_days_off for insert to authenticated
  with check ((select public.has_permission('use_modules')));

create policy "members unmark days off"
  on public.meal_plan_days_off for delete to authenticated
  using ((select public.has_permission('use_modules')));

-- Convert every plan so each entry keeps the meal it shows today. This is
-- the old counting rule, run once: meals run dinner, lunch, dinner, ...
-- from the start day; a 4-serving dish takes a dinner and the lunch after
-- it, a 2-serving dish the next free meal, an evening out one dinner; what
-- needs a dinner when the next free meal is a lunch starts at the following
-- dinner, which leaves that lunch empty. Closed plans are converted too.
-- The plan ahead's start is the one the app shows: the first dinner after
-- the current plan's last meal.
do $$
declare
  p record;
  e record;
  slot integer;
  taken integer;
  start_day date;
  current_found boolean := false;
  current_next_start date;
begin
  for p in select id, starts_on, closed_at, ahead from public.meal_plans order by ahead, created_at loop
    start_day := p.starts_on;
    if p.ahead and current_found then
      start_day := current_next_start;
      update public.meal_plans set starts_on = start_day where id = p.id and starts_on <> start_day;
    end if;

    slot := 0;
    for e in
      select id, eating_out, servings from public.meal_plan_recipes
       where plan_id = p.id order by position, added_at, id
    loop
      if (e.eating_out or e.servings = 4) and slot % 2 = 1 then
        slot := slot + 1;
      end if;
      taken := case when not e.eating_out and e.servings = 4 then 2 else 1 end;
      update public.meal_plan_recipes
         set meals = taken,
             meal = case when slot % 2 = 1 then 'lunch' else 'dinner' end,
             meal_on = start_day + case when slot % 2 = 1 then (slot + 1) / 2 else slot / 2 end
       where id = e.id;
      slot := slot + taken;
    end loop;

    if p.closed_at is null and not p.ahead then
      current_found := true;
      -- The last meal is slot - 1: a lunch, the plan ahead starts that
      -- day; a dinner, the day after. Nothing planned yet: the day after.
      current_next_start := case
        when slot = 0 then start_day + 1
        when (slot - 1) % 2 = 1 then start_day + slot / 2
        else start_day + (slot - 1) / 2 + 1
      end;
    end if;
  end loop;
end;
$$;

-- Write a plan's layout in one step, so two people never look at two
-- different plans: the plan's start, and where each entry now sits
-- (`[{"id", "meal_on", "meal", "meals"}, ...]`). It runs as the person
-- asking, so the policies still decide who may change a plan. Two entries
-- on the same meal are refused, whatever the app asked for.
create function public.set_plan_layout(p_plan uuid, p_starts_on date, p_starts_meal text, p_layout jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.meal_plans set starts_on = p_starts_on, starts_meal = p_starts_meal where id = p_plan;

  update public.meal_plan_recipes e
     set meal_on = (l.value ->> 'meal_on')::date,
         meal = l.value ->> 'meal',
         meals = (l.value ->> 'meals')::integer
    from jsonb_array_elements(p_layout) as l
   where e.id = (l.value ->> 'id')::uuid and e.plan_id = p_plan;

  if exists (
    select 1
      from public.meal_plan_recipes a
      join public.meal_plan_recipes b on b.plan_id = a.plan_id and b.id > a.id
     where a.plan_id = p_plan
       and a.meal_on is not null and b.meal_on is not null
       and (a.meal_on - date '2000-01-01') * 2 + (a.meal = 'dinner')::integer
             < (b.meal_on - date '2000-01-01') * 2 + (b.meal = 'dinner')::integer + b.meals
       and (b.meal_on - date '2000-01-01') * 2 + (b.meal = 'dinner')::integer
             < (a.meal_on - date '2000-01-01') * 2 + (a.meal = 'dinner')::integer + a.meals
  ) then
    raise exception 'Two entries are on the same meal' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.set_plan_layout(uuid, date, text, jsonb) from public, anon;
grant execute on function public.set_plan_layout(uuid, date, text, jsonb) to authenticated;

-- Start a plan (REQ-115), now with the meal it starts at. Dinner unless
-- we choose otherwise; the app only offers lunch on a weekend day.
drop function public.start_meal_plan(date);

create function public.start_meal_plan(p_starts_on date, p_starts_meal text default 'dinner')
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
  insert into public.meal_plans (starts_on, starts_meal, started_by, ahead)
  values (p_starts_on, p_starts_meal, (select auth.uid()), current_plan is not null)
  returning id into new_plan;
  return new_plan;
end;
$$;

revoke all on function public.start_meal_plan(date, text) from public, anon;
grant execute on function public.start_meal_plan(date, text) to authenticated;
