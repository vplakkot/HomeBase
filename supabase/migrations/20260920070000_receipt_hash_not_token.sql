-- REQ-22, second thoughts. The previous migration stored each device's
-- receipt token as it was sent. Review pointed out the hole: an admin can
-- read this table, so an admin could copy a live token out of it and
-- quote it back to the receipt address, recording a delivery that never
-- happened. That is exactly the lie the log exists to rule out.
--
-- So what is stored is a hash of the token instead, the same way a
-- password is never stored as typed. The sender still sends the token to
-- the phone; only its hash is written down. Reading the log now proves
-- nothing about which tokens are live.
--
-- A plain SHA-256 is enough here, unlike a password: this is 256 random
-- bits, not something a person chose, so there is no shorter route than
-- trying them all.
--
-- A rename rather than a new column, because the table is empty and
-- nothing has been sent yet. Amending the previous file in place would
-- have needed that file replayed, which means dropping a table — a
-- footgun to leave lying in a migration for every future environment.

alter table public.notification_log
  rename column receipt_token to receipt_hash;

-- The previous migration also created this index by hand, which was
-- always redundant: `unique` on the column already builds one. Two
-- indexes on the same column cost two writes on every insert and answer
-- no question the first one cannot.
drop index if exists public.notification_log_receipt_token_idx;

-- One cosmetic leftover, noted so nobody hunts for a bug: the unique
-- constraint keeps its original name, notification_log_receipt_token_key.
-- Postgres does not rename a constraint when its column is renamed. It is
-- the same in every environment — a fresh database runs these two files
-- in the same order and lands on the same name — so nothing diverges. Not
-- worth a third migration to tidy.
