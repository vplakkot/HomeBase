-- Restaurants (REQ-90, REQ-129, REQ-130): the places we want to try.
--
-- Google's terms let us keep a place's ID and nothing else from Google, so
-- that is all a row holds of the place itself. Its name, photo, cuisine,
-- neighbourhood, address, hours and website are asked of Google each time
-- the place is shown.
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  -- REQ-90: a place is on our lists once, whichever list it's on and
  -- whichever link it came from.
  google_place_id text not null unique check (google_place_id ~ '^[A-Za-z0-9_-]{10,255}$'),
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.restaurants enable row level security;
revoke all on public.restaurants from anon;

-- Either of us sees, adds and removes any place (REQ-90, REQ-129).
create policy "members read restaurants"
  on public.restaurants for select to authenticated
  using ((select public.is_member()));

create policy "members add restaurants"
  on public.restaurants for insert to authenticated
  with check ((select public.has_permission('use_modules')) and added_by = (select auth.uid()));

create policy "members remove restaurants"
  on public.restaurants for delete to authenticated
  using ((select public.has_permission('use_modules')));
