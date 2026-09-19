-- The previous migration withdrew the table-wide select on
-- household_members from `authenticated` and handed it back column by
-- column. It left `anon` alone, because Supabase's policies on this table
-- are all `to authenticated`, so a signed-out request matches no rows and
-- comes back empty whatever privileges it holds.
--
-- That leaves signed-out visitors protected by one layer where signed-in
-- members have two. Cheap to make them equal, and it states the intent
-- rather than leaving a future reader to work out why anon was skipped.
-- A separate file because the migration that added the column has already
-- run against the hosted project, and `add column` cannot be replayed.

revoke select on public.household_members from anon;
