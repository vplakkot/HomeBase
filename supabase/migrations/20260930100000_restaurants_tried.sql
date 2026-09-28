-- Restaurants batch 2 (REQ-131, REQ-132, REQ-133): a place's booking link,
-- the day we tried it, and each person's "go again?".

-- REQ-131, REQ-132: where the place takes bookings (OpenTable, Resy, Tock
-- or its own site). Ours, not Google's, so it's fine to keep.
-- REQ-133: the day either of us marked it tried; empty while it's still on
-- Want to try. Tried once: there is no visit log.
alter table public.restaurants
  add column booking_url text check (booking_url ~ '^https?://' and length(booking_url) <= 2000),
  add column tried_on date;

-- Either of us sets the booking link, or marks a place tried and undoes it.
-- Those two and nothing else: which place a row is, and who added it,
-- never change.
revoke update on public.restaurants from authenticated;
grant update (booking_url, tried_on) on public.restaurants to authenticated;

create policy "members change restaurants"
  on public.restaurants for update to authenticated
  using ((select public.has_permission('use_modules')))
  with check ((select public.has_permission('use_modules')));

-- REQ-133: one answer per person per tried place. Yes or No; no row means
-- they haven't answered yet, which keeps asking them.
create table public.restaurant_answers (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  go_again boolean not null,
  answered_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

alter table public.restaurant_answers enable row level security;
revoke all on public.restaurant_answers from anon;

create policy "members read answers"
  on public.restaurant_answers for select to authenticated
  using ((select public.is_member()));

-- Only your own answer, and only for a place that's been tried.
create policy "members answer for themselves"
  on public.restaurant_answers for insert to authenticated
  with check (
    (select public.has_permission('use_modules'))
    and user_id = (select auth.uid())
    and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.tried_on is not null)
  );

-- You can change your own answer later, never the other person's.
create policy "members change their own answer"
  on public.restaurant_answers for update to authenticated
  using (user_id = (select auth.uid()) and (select public.has_permission('use_modules')))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.tried_on is not null)
  );

-- Undoing "tried" sends the place back to Want to try with both answers
-- cleared. Nobody may delete the other person's answer directly, so the
-- database does it here, as its owner, only on that one change.
create function public.restaurants_clear_answers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.restaurant_answers where restaurant_id = new.id;
  return new;
end;
$$;

revoke all on function public.restaurants_clear_answers() from public, anon, authenticated;

create trigger restaurants_clear_answers
  after update of tried_on on public.restaurants
  for each row
  when (old.tried_on is not null and new.tried_on is null)
  execute function public.restaurants_clear_answers();
