-- REQ-160: removing a device from the list, including one nobody is holding.
--
-- Deleting the row is enough to stop the sender reaching the device. But a
-- phone that still has its notification permission and its note of itself
-- signs its device up again, quietly, the next time Home opens on it
-- (KeepThisDevice). So a removed device leaves a mark: its address, as a
-- one-way hash so the address itself isn't kept. That quiet sign-up checks
-- for the mark and stays out. Turning notifications on again by hand on
-- that phone is a deliberate tap, and clears it.
--
-- Only the app's server touches this table, with the secret key.

create table public.removed_devices (
  endpoint_hash text primary key,
  user_id uuid not null references public.household_members (user_id) on delete cascade,
  removed_at timestamptz not null default now()
);

alter table public.removed_devices enable row level security;
revoke all on public.removed_devices from anon, authenticated;
