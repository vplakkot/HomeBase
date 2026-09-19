-- REQ-20. Each device that agrees to receive notifications gets a row:
-- the address its push service gave it (endpoint) and the two keys a
-- sender needs to encrypt a message only that device can read. One row
-- per device, so a person can have several.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- Filled in from the signed-in person, so the app never sends it and
  -- can't send someone else's. Leaving the household removes the devices.
  user_id uuid not null default auth.uid()
    references public.household_members (user_id) on delete cascade,
  -- The sender (REQ-21) will send a request to every endpoint stored
  -- here, so only the push services' own addresses are accepted: Apple,
  -- Google, Mozilla, Microsoft. Anything else, such as an address inside
  -- someone's network, is refused by the database, whichever way it
  -- arrives.
  endpoint text not null unique
    check (endpoint ~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  p256dh text not null,
  auth text not null,
  -- Which browser and device, so a list of devices is readable later.
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Every member sees and manages only their own devices. Nobody else
-- reads them through the API, admins included: who has which device isn't
-- household data. Like every other policy here, each one also asks
-- is_member(), never a role name. The sender in REQ-21 runs with no
-- signed-in person, so it will need its own way in (service_role), like
-- the notifications flag.
create policy "Members read their own devices"
  on public.push_subscriptions for select to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

create policy "Members add their own devices"
  on public.push_subscriptions for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));

create policy "Members update their own devices"
  on public.push_subscriptions for update to authenticated
  using (public.is_member() and user_id = (select auth.uid()))
  with check (public.is_member() and user_id = (select auth.uid()));

create policy "Members remove their own devices"
  on public.push_subscriptions for delete to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

-- Every policy above is `to authenticated`; this is the second layer. A
-- signed-out visitor can't even ask.
revoke all on public.push_subscriptions from anon;
