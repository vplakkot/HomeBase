-- An income source gets a name (#128): one person can hold two jobs, and
-- "Megan" twice in the list tells you nothing. Existing rows keep an
-- empty name, which the screens show as just the owner, so nothing
-- breaks while the two of us fill them in.
alter table public.income_sources
  add column name text not null default '';
