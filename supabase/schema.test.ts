import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The real guard lives in Postgres, which these tests can't run. What they
// can do is pin the migration's shape so the guard doesn't quietly
// disappear or loosen in a later edit.
const MIGRATIONS_DIR = join(__dirname, "migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function readMigrations(): string {
  return migrationFiles()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf-8"))
    .join("\n");
}

function readMigration(prefix: string): string {
  const file = migrationFiles().find((name) => name.startsWith(prefix));
  if (!file) {
    throw new Error(`No migration starting with ${prefix}`);
  }
  return readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
}

const sql = readMigrations();
const firstMigration = readMigration("20260918140000");

describe("household schema migration", () => {
  it("seeds Admin and Member as rows in the roles table", () => {
    expect(sql).toMatch(/create table public\.roles/);
    expect(sql).toMatch(/insert into public\.roles \(name\) values \('Admin'\), \('Member'\)/);
  });

  it("links each user to one household with one role", () => {
    expect(sql).toMatch(/create table public\.household_members \(\s*user_id uuid primary key references auth\.users/);
    expect(sql).toMatch(/household_id uuid not null references public\.households/);
    expect(sql).toMatch(/role_id uuid not null references public\.roles/);
  });

  it("creates the household and its Admin when the first auth user is created", () => {
    expect(sql).toMatch(/create trigger on_auth_user_created\s+after insert on auth\.users/);
    expect(sql).toMatch(/insert into public\.households default values/);
    expect(sql).toMatch(/from public\.roles where name = 'Admin'/);
  });

  it("refuses every self sign-up after the household exists", () => {
    expect(sql).toMatch(/if exists \(select 1 from public\.households\) then\s+raise exception/);
  });

  it("switches row-level security on for every table before any policy exists", () => {
    for (const table of ["roles", "households", "household_members"]) {
      expect(firstMigration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
    }
    expect(firstMigration).not.toMatch(/create policy/);
  });

  it("lets signed-out visitors ask only whether sign-up is still open", () => {
    expect(sql).toMatch(/create function public\.household_exists\(\)\s+returns boolean/);
    expect(sql).toMatch(/grant execute on function public\.household_exists\(\) to anon, authenticated/);
  });
});

describe("permissions and row-level security migration", () => {
  const policies = sql.match(/create policy[\s\S]*?;/g) ?? [];

  it("stores each role's permissions as rows", () => {
    expect(sql).toMatch(/create table public\.role_permissions \(\s*role_id uuid not null references public\.roles/);
    expect(sql).toMatch(/\('Admin', 'manage_members'\)/);
    expect(sql).toMatch(/\('Member', 'use_modules'\)/);
  });

  it("gates every policy on membership or a permission, never on a role name", () => {
    expect(policies.length).toBeGreaterThanOrEqual(7);
    for (const policy of policies) {
      expect(policy).toMatch(/public\.(is_member|has_permission)\(/);
      expect(policy).not.toMatch(/'Admin'|'Member'/);
    }
  });

  it("lets every member read all household data", () => {
    for (const table of ["households", "roles", "role_permissions", "household_members"]) {
      expect(policies.some((p) => p.includes(`on public.${table} for select`) && p.includes("is_member"))).toBe(true);
    }
  });

  it("requires a permission to change memberships and roles", () => {
    expect(policies.some((p) => p.includes("on public.household_members for all") && p.includes("'manage_members'"))).toBe(true);
    expect(policies.some((p) => p.includes("on public.roles for all") && p.includes("'manage_roles'"))).toBe(true);
    expect(policies.some((p) => p.includes("on public.role_permissions for all") && p.includes("'manage_roles'"))).toBe(true);
  });

  it("limits how many people may hold a role, as data on the role", () => {
    expect(sql).toMatch(/add column max_holders integer/);
    expect(sql).toMatch(/update public\.roles set max_holders = 2 where name = 'Admin'/);
    expect(sql).toMatch(/create trigger enforce_role_holder_limit\s+before insert or update of role_id, household_id on public\.household_members/);
    expect(sql).toMatch(/if current_holders >= limit_holders then\s+raise exception/);
  });

  it("exposes the two checks as security-definer functions the app can call", () => {
    for (const fn of ["is_member()", "has_permission(text)"]) {
      expect(sql).toContain(`grant execute on function public.${fn} to anon, authenticated, service_role`);
    }
    expect(sql).toMatch(/create function public\.has_permission\(permission text\)[\s\S]*?security definer[\s\S]*?set search_path = ''/);
  });
});

describe("admin-created members migration", () => {
  const migration = readMigration("20260918180000");

  it("adds an invitations table that only manage_members holders may touch", () => {
    expect(migration).toMatch(/create table public\.member_invitations \(\s*email text primary key check \(email = lower\(email\)\)/);
    expect(migration).toMatch(/alter table public\.member_invitations enable row level security/);
    expect(migration).toMatch(/on public\.member_invitations for all to authenticated\s+using \(\(select public\.has_permission\('manage_members'\)\)\)/);
  });

  it("replaces the sign-up trigger function rather than adding a second one", () => {
    expect(migration).toMatch(/create or replace function public\.handle_new_user\(\)/);
    expect(migration).not.toMatch(/create trigger/);
  });

  it("still creates the household and its Admin for the very first user", () => {
    expect(migration).toMatch(/if existing_household_id is null then[\s\S]*?insert into public\.households default values[\s\S]*?where name = 'Admin'/);
  });

  it("admits a new user only if an invitation for their email exists, then uses it up", () => {
    expect(migration).toMatch(/from public\.member_invitations\s+where email = lower\(new\.email\)/);
    expect(migration).toMatch(/if not found then\s+raise exception 'Sign-up is closed/);
    expect(migration).toMatch(/delete from public\.member_invitations where email = invitation\.email/);
  });

  it("grants the invited role, Member unless the admin chose one", () => {
    expect(migration).toMatch(/role_to_grant := invitation\.role_id;\s+if role_to_grant is null then[\s\S]*?where name = 'Member'/);
    expect(migration).toMatch(/values \(new\.id, existing_household_id, role_to_grant\)/);
  });

  it("does not rely on app_metadata at insert time", () => {
    expect(migration).not.toMatch(/raw_app_meta_data/);
  });
});

describe("members overview and minimum holders migration", () => {
  const migration = readMigration("20260918200000");

  it("reads names and emails from auth.users on the caller's behalf, only for manage_members holders", () => {
    expect(migration).toMatch(/create function public\.household_members_overview\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/);
    expect(migration).toMatch(/join auth\.users u on u\.id = hm\.user_id/);
    expect(migration).toMatch(/where \(select public\.has_permission\('manage_members'\)\)/);
    expect(migration).toContain("grant execute on function public.household_members_overview() to authenticated, service_role");
    expect(migration).not.toMatch(/to anon/);
  });

  it("stores the floor on a role as data, like the ceiling", () => {
    expect(migration).toMatch(/add column min_holders integer/);
    expect(migration).toMatch(/update public\.roles set min_holders = 1 where name = 'Admin'/);
  });

  it("refuses a change or removal that would leave a role below its floor", () => {
    expect(migration).toMatch(/create trigger enforce_role_holder_minimum\s+before update of role_id or delete on public\.household_members/);
    expect(migration).toMatch(/if remaining < minimum then\s+raise exception 'This role must keep at least % holder\(s\)'/);
    expect(migration).toMatch(/and user_id <> old\.user_id/);
  });
});

describe("per-member notification switch migration", () => {
  const migration = readMigration("20260919140000");

  it("adds the switch to the membership, off unless someone turns it on", () => {
    expect(migration).toMatch(
      /alter table public\.household_members\s+add column notifications_enabled boolean not null default false/,
    );
  });

  it("hides the switch from members with a column-level grant, not just the interface", () => {
    // A column-level revoke does nothing while a table-level grant stands,
    // so the table grant must be withdrawn and replaced column by column.
    expect(migration).toMatch(/revoke select on public\.household_members from authenticated/);
    expect(migration).toMatch(
      /grant select \(user_id, household_id, role_id, created_at\)\s+on public\.household_members to authenticated/,
    );
    expect(migration).not.toMatch(/grant select[^;]*notifications_enabled[^;]*to authenticated/);
  });

  it("closes the same door to signed-out visitors, not just members", () => {
    // Policies on this table are all `to authenticated`, so anon already gets
    // nothing. This is the second layer, so both roles are guarded the same way.
    const anonRevoke = readMigration("20260919150000");
    expect(anonRevoke).toMatch(/revoke select on public\.household_members from anon/);
  });

  it("re-creates the roster function rather than replacing it, since its columns changed", () => {
    expect(migration).toMatch(/drop function public\.household_members_overview\(\)/);
    expect(migration).toMatch(/create function public\.household_members_overview\(\)/);
    expect(migration).not.toMatch(/create or replace function public\.household_members_overview/);
  });

  it("returns the switch to manage_members holders only, through that function", () => {
    expect(migration).toMatch(/returns table \([\s\S]*?notifications_enabled boolean\s*\)/);
    expect(migration).toMatch(/hm\.notifications_enabled/);
    expect(migration).toMatch(/where \(select public\.has_permission\('manage_members'\)\)/);
    expect(migration).toMatch(/security definer[\s\S]*?set search_path = ''/);
    expect(migration).toContain(
      "grant execute on function public.household_members_overview() to authenticated, service_role",
    );
  });
});

describe("invitations expire migration", () => {
  const migration = readMigration("20260919120000");

  it("gives every invitation a ten-minute life, with no null allowed", () => {
    expect(migration).toMatch(
      /alter table public\.member_invitations\s+add column expires_at timestamptz not null default \(now\(\) \+ interval '10 minutes'\)/,
    );
  });

  it("admits a new user only on an invitation that has not expired", () => {
    expect(migration).toMatch(
      /where email = lower\(new\.email\)\s+and expires_at > now\(\)/,
    );
    expect(migration).toMatch(/if not found then\s+raise exception 'Sign-up is closed/);
  });

  it("dates rows that predate the column from their own creation, not from now", () => {
    expect(migration).toMatch(
      /update public\.member_invitations\s+set expires_at = created_at \+ interval '10 minutes'/,
    );
  });

  it("tidies expired invitations at sign-up as well, best-effort", () => {
    // Best-effort on purpose: this delete is inside the sign-up transaction, so
    // a refused sign-up rolls it back. The guard is the expires_at test above.
    expect(migration).toMatch(/delete from public\.member_invitations where expires_at <= now\(\)/);
  });

  it("still uses the invitation up and keeps the first-user path untouched", () => {
    expect(migration).toMatch(/delete from public\.member_invitations where email = invitation\.email/);
    expect(migration).toMatch(/if existing_household_id is null then[\s\S]*?where name = 'Admin'/);
  });

  it("replaces the trigger function rather than adding a second trigger", () => {
    expect(migration).toMatch(/create or replace function public\.handle_new_user\(\)/);
    expect(migration).not.toMatch(/create trigger/);
    expect(migration).toMatch(/security definer[\s\S]*?set search_path = ''/);
  });
});

describe("floor applies while the household exists migration", () => {
  const migration = readMigration("20260919100000");

  it("lets a membership go when its household has already been deleted", () => {
    expect(migration).toMatch(
      /if tg_op = 'DELETE'\s+and not exists \(select 1 from public\.households where id = old\.household_id\) then\s+return old;/,
    );
  });

  it("still counts the remaining holders for every other removal or demotion", () => {
    expect(migration).toMatch(/select min_holders into minimum/);
    expect(migration).toMatch(/if remaining < minimum then\s+raise exception 'This role must keep at least % holder\(s\)'/);
    expect(migration).toMatch(/using hint = 'Give the role to someone else first, or delete the household itself\.'/);
  });

  it("replaces the existing function instead of adding a second trigger", () => {
    expect(migration).toMatch(/create or replace function public\.enforce_role_holder_minimum\(\)/);
    expect(migration).not.toMatch(/create trigger/);
    expect(migration).toMatch(/security definer[\s\S]*?set search_path = ''/);
    expect(migration).toContain("revoke all on function public.enforce_role_holder_minimum() from public;");
  });
});

describe("push subscriptions migration", () => {
  const migration = readMigration("20260919170000");

  it("keeps one row per device, so a person can have several", () => {
    expect(migration).toMatch(/create table public\.push_subscriptions/);
    expect(migration).toMatch(/endpoint text not null unique/);
    // Nothing makes a person's user_id unique: a second device is a second row.
    expect(migration).not.toMatch(/user_id uuid[^,]*unique/);
    expect(migration).not.toMatch(/unique \(user_id\)/);
  });

  it("saves each device against the signed-in person, and drops it when they leave", () => {
    expect(migration).toMatch(
      /user_id uuid not null default auth\.uid\(\)\s+references public\.household_members \(user_id\) on delete cascade/,
    );
  });

  it("lets each member see and manage only their own devices", () => {
    expect(migration).toMatch(/alter table public\.push_subscriptions enable row level security/);
    for (const action of ["select", "insert", "update", "delete"]) {
      expect(migration).toMatch(
        new RegExp(`on public\\.push_subscriptions for ${action} to authenticated`),
      );
    }
    const policies = migration.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy).toMatch(/public\.is_member\(\) and user_id = \(select auth\.uid\(\)\)/);
      // No permission widens it: an admin sees only their own devices too.
      expect(policy).not.toMatch(/has_permission/);
    }
  });

  it("gives signed-out visitors nothing", () => {
    expect(migration).toContain("revoke all on public.push_subscriptions from anon;");
  });

  // Postgres runs the real check. This lifts its pattern out of the file
  // and tries it on sample addresses, so a loosened pattern fails here.
  it("accepts only the push services' own addresses", () => {
    const pattern = migration.match(/check \(endpoint ~ '([^']+)'\)/)?.[1];
    expect(pattern).toBeDefined();
    const allowed = new RegExp(pattern!);
    for (const endpoint of [
      "https://web.push.apple.com/QGuQyavXutnMfBCd",
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://wns2-bl2p.notify.windows.com/w/?token=abc",
    ]) {
      expect(allowed.test(endpoint)).toBe(true);
    }
    for (const endpoint of [
      "http://web.push.apple.com/QGuQ",
      "https://web.push.apple.com.example.com/QGuQ",
      "https://example.com/web.push.apple.com/",
      "https://192.168.1.10/push",
      "https://localhost:3000/",
    ]) {
      expect(allowed.test(endpoint)).toBe(false);
    }
  });
});

describe("hourly test notification migration", () => {
  const migration = readMigration("20260919190000");

  it("runs on the hour, around the clock", () => {
    expect(migration).toMatch(/cron\.schedule\(\s*'hourly-test-notification',[\s\S]*?'0 \* \* \* \*'/);
  });

  it("turns on the scheduler and the database's way of calling an address", () => {
    expect(migration).toMatch(/create extension if not exists pg_cron/);
    expect(migration).toMatch(/create extension if not exists pg_net/);
  });

  it("calls the app with the shared secret, both read from the vault", () => {
    expect(migration).toMatch(/net\.http_post\(/);
    for (const name of ["notify_url", "notify_secret"]) {
      expect(migration).toMatch(
        new RegExp(`select decrypted_secret from vault\\.decrypted_secrets where name = '${name}'`),
      );
    }
    expect(migration).toMatch(/'Bearer ' \|\|/);
  });

  // A secret in git is a secret given away, and a hard-coded address would
  // need a migration to change.
  it("holds no address and no secret of its own", () => {
    expect(migration).not.toMatch(/https?:\/\//);
    expect(migration).not.toMatch(/Bearer [A-Za-z0-9._-]{8,}/);
  });

  // Without both, the job would fail every hour instead of waiting quietly.
  it("does nothing until both are in the vault", () => {
    expect(migration).toMatch(/where exists \(\s*select 1 from vault\.decrypted_secrets where name = 'notify_url'\s*\) and exists \(/);
  });
});

// Vin, 2026-09-24: the real Finances reminders replace it.
describe("stopping the hourly test notification", () => {
  const migration = readMigration("20260924160000");

  it("unschedules that job by name, and nothing if it's already gone", () => {
    expect(migration).toMatch(
      /select cron\.unschedule\(jobid\) from cron\.job where jobname = 'hourly-test-notification'/,
    );
  });

  it("leaves the vault secrets the Finances reminders read", () => {
    expect(migration).not.toMatch(/vault\.|delete from/);
  });
});

describe("notification log migration", () => {
  const migration = readMigration("20260920060000");

  it("records who, which device, when, and how it was triggered", () => {
    expect(migration).toMatch(/create table public\.notification_log/);
    expect(migration).toMatch(/sent_at timestamptz not null default now\(\)/);
    expect(migration).toMatch(/trigger text not null check \(trigger in \('hourly', 'manual'\)\)/);
    expect(migration).toMatch(
      /user_id uuid not null\s+references public\.household_members \(user_id\) on delete cascade/,
    );
    expect(migration).toMatch(/device text not null/);
    expect(migration).toMatch(/delivered_at timestamptz/);
    expect(migration).toMatch(/tapped_at timestamptz/);
  });

  // The push address is the thing that lets anyone send to a phone. The
  // log holds a fingerprint instead, so it must not gain an endpoint
  // column in a later edit.
  it("never stores an address a device could be reached at", () => {
    // The SQL itself, not the prose around it: the comments are allowed
    // to discuss endpoints, the table is not allowed to hold one.
    const statements = migration.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/endpoint/);
    expect(statements).not.toMatch(/p256dh/);
  });

  it("gives each row its own receipt secret, and only one row per secret", () => {
    expect(migration).toMatch(/receipt_token text not null unique/);
  });

  // Only the sender and the receipt address write here, both with the
  // secret key. If a signed-in person could write, anyone could claim a
  // delivery that never happened.
  it("lets an admin read it and nobody at all write it", () => {
    expect(migration).toMatch(/alter table public\.notification_log enable row level security/);
    expect(migration).toMatch(
      /on public\.notification_log for select to authenticated/,
    );
    expect(migration).toMatch(/has_permission\('manage_members'\)/);
    for (const action of ["insert", "update", "delete"]) {
      expect(migration).not.toMatch(
        new RegExp(`on public\\.notification_log for ${action}`),
      );
    }
    expect(migration).toMatch(/revoke all on public\.notification_log from anon/);
  });

  it("deletes entries older than thirty days, on a daily schedule", () => {
    expect(migration).toMatch(
      /cron\.schedule\(\s*'delete-old-notification-log'/,
    );
    expect(migration).toMatch(/interval '30 days'/);
    // Daily, and deliberately not on the hour, so it never races the
    // hourly send.
    const schedule = migration.match(/'delete-old-notification-log',[\s\S]*?'([^']+)'/);
    expect(schedule?.[1]).toBe("20 4 * * *");
  });
});

describe("receipt hash migration", () => {
  const migration = readMigration("20260920070000");

  // An admin can read the log. Storing the token itself would let them
  // copy one out and quote it back, recording a delivery that never
  // happened — the one lie the log exists to rule out.
  it("stores a hash of the receipt token rather than the token", () => {
    expect(migration).toMatch(
      /alter table public\.notification_log\s+rename column receipt_token to receipt_hash/,
    );
  });

  it("drops the hand-made index that duplicated the unique constraint", () => {
    expect(migration).toMatch(
      /drop index if exists public\.notification_log_receipt_token_idx/,
    );
  });

  // Renaming an empty table's column is safe to replay against a fresh
  // database; dropping and recreating the table is not, and would leave
  // a footgun in the file for every future environment.
  it("never drops the table to get there", () => {
    const statements = migration.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/drop table/);
  });
});

describe("dated splits and income history (#132)", () => {
  const dated = readMigration("20260922210000");

  it("carries the saved budget years over as splits starting that April", () => {
    expect(dated).toMatch(/insert into public\.splits[\s\S]*make_date\(start_year, 4, 1\)/);
    expect(dated).toMatch(/insert into public\.split_shares[\s\S]*from public\.budget_year_shares/);
    expect(dated).toMatch(/drop table public\.budget_years/);
  });

  it("keeps the same rules on the new tables: members read, the key writes", () => {
    for (const table of ["splits", "split_shares"]) {
      expect(dated).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
      expect(dated).toMatch(new RegExp(`revoke all on public\\.${table} from anon;`));
      expect(dated).toMatch(
        new RegExp(`on public\\.${table} for select to authenticated\\s+using \\(\\(select public\\.is_member\\(\\)\\)\\)`),
      );
      expect(dated).toMatch(
        new RegExp(`on public\\.${table} for all to authenticated\\s+using \\(\\(select public\\.has_permission\\('manage_budget'\\)\\)\\)`),
      );
      expect(dated).toMatch(
        new RegExp(`after insert or update on public\\.${table}\\s+deferrable initially deferred`),
      );
    }
  });

  it("starts a split on the first of a month, so months can't half-match", () => {
    expect(dated).toMatch(/effective_from date not null unique check \(extract\(day from effective_from\) = 1\)/);
    expect(dated).toMatch(/date_trunc\('month', p_effective_from\)/);
  });

  it("changes an income source by ending the old row and starting a new one", () => {
    expect(dated).toMatch(/add column effective_from date not null default current_date,\s+add column ended_on date/);
    expect(dated).toMatch(/create function public\.change_income_source[\s\S]*set ended_on = current_date[\s\S]*insert into public\.income_sources/);
    expect(dated).toMatch(/create function public\.change_income_source[\s\S]*?security invoker/);
  });
});

describe("the household's clock, and a started split (#132 reviews)", () => {
  const clock = readMigration("20260922230000");
  const locked = readMigration("20260923010000");

  it("takes the day from the caller, never from the database server", () => {
    expect(clock).toMatch(/create function public\.change_income_source\([\s\S]*?p_on date\s*\)/);
    expect(clock).toMatch(/set ended_on = p_on/);
    expect(locked).toMatch(/create function public\.save_split\([\s\S]*?p_today date\s*\)/);
    expect(locked).toMatch(/alter column effective_from drop default/);
    expect(locked).toMatch(/at time zone 'America\/New_York'/);
  });

  it("refuses to save a split whose month has already passed", () => {
    expect(locked).toMatch(
      /if starts < date_trunc\('month', p_today\)::date then\s+raise exception/,
    );
  });

  it("re-issues the keys it took away when it replaced each function", () => {
    expect(clock).toMatch(/grant execute on function public\.change_income_source\(uuid, text, uuid, numeric, text, date, date\)\s+to authenticated;/);
    expect(locked).toMatch(/grant execute on function public\.save_split\(date, text, jsonb, date\) to authenticated;/);
  });
});

describe("Finances setup migration (REQ-50, 51, 94)", () => {
  const setup = readMigration("20260922120000");
  const tables = ["budget_years", "budget_year_shares", "income_sources", "bills"];

  it("hands the new manage_budget key to Admin, by permission not by role", () => {
    expect(setup).toMatch(/insert into public\.role_permissions[\s\S]*'manage_budget' from public\.roles where name = 'Admin'/);
  });

  it("switches row-level security on for all four tables", () => {
    for (const table of tables) {
      expect(setup).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
    }
  });

  it("lets any member read each table and only the manage_budget key change it", () => {
    for (const table of tables) {
      expect(setup).toMatch(
        new RegExp(`on public\\.${table} for select to authenticated\\s+using \\(\\(select public\\.is_member\\(\\)\\)\\)`),
      );
      expect(setup).toMatch(
        new RegExp(
          `on public\\.${table} for all to authenticated\\s+using \\(\\(select public\\.has_permission\\('manage_budget'\\)\\)\\)\\s+with check \\(\\(select public\\.has_permission\\('manage_budget'\\)\\)\\)`,
        ),
      );
    }
    expect(setup).not.toMatch(/to anon/);
  });

  it("takes the default table access away from signed-out visitors", () => {
    for (const table of tables) {
      expect(setup).toMatch(new RegExp(`revoke all on public\\.${table} from anon;`));
    }
    expect(setup).toMatch(/revoke all on function public\.household_people\(\) from public, anon;/);
    expect(setup).toMatch(/revoke all on function public\.save_budget_year\(integer, text, jsonb\) from public, anon;/);
  });

  it("refuses a split that doesn't total 100, checked when the save commits", () => {
    expect(setup).toMatch(/if total <> 100 then\s+raise exception/);
    for (const table of ["budget_years", "budget_year_shares"]) {
      expect(setup).toMatch(
        new RegExp(`after insert or update on public\\.${table}\\s+deferrable initially deferred`),
      );
    }
  });

  it("saves a year and its shares in one call that runs as the caller, so the policies apply", () => {
    expect(setup).toMatch(/create function public\.save_budget_year[\s\S]*?security invoker/);
  });

  it("keeps the amounts, cadences, bill types and due days to what the forms allow", () => {
    expect(setup).toMatch(/cadence in \('weekly', 'biweekly', 'monthly'\)/);
    expect(setup).toMatch(/kind in \('rent', 'card', 'other'\)/);
    expect(setup).toMatch(/due_day between 1 and 31/);
    expect(setup).toMatch(/net_amount > 0/);
  });

  it("shows the household's people to members only", () => {
    expect(setup).toMatch(/create function public\.household_people\(\)[\s\S]*?where \(select public\.is_member\(\)\)/);
    expect(setup).toMatch(/grant execute on function public\.household_people\(\) to authenticated;/);
  });
});

describe("storage migration (REQ-87, REQ-98)", () => {
  const storage = readMigration("20260924200000");

  it("hands out entry numbers in the database, never chosen or changed", () => {
    expect(storage).toMatch(/number bigint generated always as identity unique/);
  });

  it("keeps contents for boxes only", () => {
    expect(storage).toMatch(/contents text check \(is_box or contents is null\)/);
  });

  it("lets members, and only members, see and change entries", () => {
    expect(storage).toMatch(/enable row level security/);
    expect(storage).toMatch(/revoke all on public\.storage_entries from anon/);
    for (const action of ["select", "insert", "update", "delete"]) {
      expect(storage).toMatch(new RegExp(`on public\\.storage_entries for ${action} to authenticated`));
    }
  });

  it("ties archived to being in a box, and keeps a box holding files from being removed", () => {
    expect(storage).toMatch(/references public\.storage_entries \(id\) on delete restrict/);
    expect(storage).toMatch(/check \(\(status = 'archived'\) = \(storage_entry_id is not null\)\)/);
  });

  it("refuses a file outside a box, and un-boxing a box that holds files", () => {
    expect(storage).toMatch(/before insert or update of storage_entry_id on public\.paperwork_files/);
    expect(storage).toMatch(/before update of is_box on public\.storage_entries/);
  });
});

describe("drinks migration (REQ-37, REQ-30, REQ-29)", () => {
  const drinks = readMigration("20260926100000");

  it("needs only a name, and never both a vintage and NV", () => {
    expect(drinks).toMatch(/name text not null check \(btrim\(name\) <> ''\)/);
    expect(drinks).toMatch(/check \(not \(non_vintage and vintage is not null\)\)/);
  });

  it("lets members, and only members, see and change drinks and ratings", () => {
    for (const table of ["drinks", "drink_ratings"]) {
      expect(drinks).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
      expect(drinks).toMatch(new RegExp(`revoke all on public\\.${table} from anon`));
      for (const action of ["select", "insert", "update", "delete"]) {
        expect(drinks).toMatch(new RegExp(`on public\\.${table} for ${action} to authenticated`));
      }
    }
  });

  it("keeps one rating per person per drink, whole stars 1 to 5, a one-line comment", () => {
    expect(drinks).toMatch(/stars smallint not null check \(stars between 1 and 5\)/);
    expect(drinks).toMatch(/primary key \(drink_id, user_id\)/);
    expect(drinks).toMatch(/comment text check \(comment !~ '\[\\r\\n\]'/);
  });

  it("lets each person write only their own rating", () => {
    const own = drinks.match(/create policy "members (rate for themselves|change their own rating|remove their own rating)"[\s\S]*?;/g) ?? [];
    expect(own).toHaveLength(3);
    for (const policy of own) expect(policy).toMatch(/user_id = \(select auth\.uid\(\)\)/);
  });

  it("stamps a rating's last change with the database's clock", () => {
    expect(drinks).toMatch(/before insert or update on public\.drink_ratings/);
    expect(drinks).toMatch(/new\.updated_at := now\(\)/);
  });
});

describe("drinks: how we got it and buy again (REQ-35, REQ-36, REQ-34)", () => {
  const how = readMigration("20260926120000");

  it("gives every drink one of four values, and ties each extra to its value", () => {
    expect(how).toMatch(/add column how text not null default 'bought'\s+check \(how in \('bought', 'gift', 'had_out', 'want_to_try'\)\)/);
    expect(how).toMatch(/alter column how drop default/);
    expect(how).toMatch(/check \(price is null or how = 'bought'\)/);
    expect(how).toMatch(/check \(place is null or how in \('bought', 'had_out'\)\)/);
    expect(how).toMatch(/check \(gift_from is null or how = 'gift'\)/);
  });

  it("keeps buy again on each person's own rating row", () => {
    expect(how).toMatch(/alter table public\.drink_ratings\s+add column buy_again boolean;/);
  });

  it("refuses a rating on a wine we only want to try, and a rated drink going back to it", () => {
    expect(how).toMatch(/before insert or update on public\.drink_ratings/);
    expect(how).toMatch(/how = 'want_to_try'/);
    expect(how).toMatch(/before update of how on public\.drinks/);
    expect(how).toMatch(/exists \(select 1 from public\.drink_ratings where drink_id = new\.id\)/);
  });
});

describe("drinks: label photos (REQ-32)", () => {
  const photos = readMigration("20260926140000");

  it("keeps them in a private bucket that takes only JPEGs up to 1 MB", () => {
    expect(photos).toMatch(/values \('drink-labels', 'drink-labels', false, 1048576, array\['image\/jpeg'\]\)/);
  });

  it("lets only household members see or change them", () => {
    for (const action of ["select", "insert", "update", "delete"]) {
      expect(photos).toMatch(new RegExp(`on storage\\.objects for ${action} to authenticated`));
    }
    expect(photos.match(/bucket_id = 'drink-labels' and \(select public\.(is_member|has_permission)/g)).toHaveLength(5);
    expect(photos).not.toMatch(/to anon/);
  });

  it("keeps a back label only with a front one", () => {
    expect(photos).toMatch(/check \(back_label is null or front_label is not null\)/);
  });
});

describe("meal plan: hidden recipes and the week's plan (REQ-114, REQ-115)", () => {
  const plan = readMigration("20260927100000");

  it("hides a recipe with a flag rather than deleting it", () => {
    expect(plan).toMatch(/alter table public\.recipes add column hidden boolean not null default false;/);
  });

  it("allows one open plan at a time", () => {
    expect(plan).toMatch(/create unique index meal_plans_one_open on public\.meal_plans \(\(true\)\) where closed_at is null;/);
  });

  it("puts a recipe in a plan once, at 4 servings or 2", () => {
    expect(plan).toMatch(/servings integer not null default 4 check \(servings in \(2, 4\)\)/);
    expect(plan).toMatch(/primary key \(plan_id, recipe_id\)/);
  });

  it("lets every household member read and change both tables, and no one else", () => {
    for (const table of ["meal_plans", "meal_plan_recipes"]) {
      expect(plan).toMatch(new RegExp(`alter table public\\.${table} enable row level security;`));
      expect(plan).toMatch(new RegExp(`revoke all on public\\.${table} from anon;`));
      for (const action of ["select", "insert", "update", "delete"]) {
        expect(plan).toMatch(new RegExp(`on public\\.${table} for ${action} to authenticated`));
      }
    }
    expect(plan).not.toMatch(/to anon/);
  });
});

describe("meal plan: closing a week and rating (REQ-116)", () => {
  const close = readMigration("20260928100000");

  it("never lets a carried-over recipe count as cooked", () => {
    expect(close).toMatch(/add column carry_over boolean not null default false/);
    expect(close).toMatch(/check \(not \(carry_over and cooked\)\)/);
  });

  it("keeps one rating per person per recipe, 1 to 5, written only by its owner", () => {
    expect(close).toMatch(/stars smallint not null check \(stars between 1 and 5\)/);
    expect(close).toMatch(/primary key \(recipe_id, user_id\)/);
    for (const action of ["insert", "update", "delete"]) {
      expect(close).toMatch(new RegExp(`on public\\.recipe_ratings for ${action} to authenticated\\s+(using|with check) \\(user_id = \\(select auth\\.uid\\(\\)\\)`));
    }
  });

  it("shows each person only their own rating questions, which only closing a plan writes", () => {
    expect(close).toMatch(/on public\.recipe_rating_prompts for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)/);
    expect(close).not.toMatch(/on public\.recipe_rating_prompts for insert/);
  });

  it("changes a plan directly only while it's open, so closing and reopening go through the functions", () => {
    expect(close).toMatch(/drop policy "members change plans" on public\.meal_plans;/);
    expect(close).toMatch(/on public\.meal_plans for update to authenticated\s+using \(\(select public\.has_permission\('use_modules'\)\) and closed_at is null\)\s+with check \(\(select public\.has_permission\('use_modules'\)\) and closed_at is null\)/);
  });

  it("closes, starts and reopens plans only for household members, never signed-out visitors", () => {
    for (const fn of ["close_meal_plan(uuid)", "start_meal_plan(date)", "reopen_meal_plan(uuid)"]) {
      const escaped = fn.replace(/[()]/g, "\\$&");
      expect(close).toMatch(new RegExp(`revoke all on function public\\.${escaped} from public, anon;`));
      expect(close).toMatch(new RegExp(`grant execute on function public\\.${escaped} to authenticated;`));
    }
    expect(close.match(/if not public\.has_permission\('use_modules'\) then/g)).toHaveLength(3);
  });
});

describe("meal plan: by meal, and planning ahead (REQ-162, REQ-164)", () => {
  const ahead = readMigration("20261005100000");

  it("allows one current plan and one plan ahead, never two of either", () => {
    expect(ahead).toMatch(/add column ahead boolean not null default false;/);
    expect(ahead).toMatch(/drop index public\.meal_plans_one_open;/);
    expect(ahead).toMatch(/create unique index meal_plans_one_current on public\.meal_plans \(\(true\)\) where closed_at is null and not ahead;/);
    expect(ahead).toMatch(/create unique index meal_plans_one_ahead on public\.meal_plans \(\(true\)\) where closed_at is null and ahead;/);
  });

  it("starts a plan without closing another: a second one goes ahead", () => {
    const start = ahead.slice(ahead.indexOf("function public.start_meal_plan"), ahead.indexOf("function public.close_meal_plan"));
    expect(start).not.toMatch(/close_meal_plan/);
    expect(start).toMatch(/current_plan is not null/);
  });

  it("gives an entry its own id and place, and lets an evening out have no recipe", () => {
    expect(ahead).toMatch(/drop constraint meal_plan_recipes_pkey;/);
    expect(ahead).toMatch(/add column id uuid not null default gen_random_uuid\(\);/);
    expect(ahead).toMatch(/unique \(plan_id, recipe_id\)/);
    expect(ahead).toMatch(/alter column recipe_id drop not null;/);
    expect(ahead).toMatch(/check \(eating_out = \(recipe_id is null\)\)/);
    expect(ahead).toMatch(/add column position integer not null default 0;/);
  });

  it("reorders as the person asking, so the policies still decide who may", () => {
    expect(ahead).toMatch(/function public\.set_plan_order\(p_plan uuid, p_order uuid\[\]\)[\s\S]*security invoker/);
    expect(ahead).toMatch(/revoke all on function public\.set_plan_order\(uuid, uuid\[\]\) from public, anon;/);
    expect(ahead).toMatch(/grant execute on function public\.set_plan_order\(uuid, uuid\[\]\) to authenticated;/);
  });

  it("never asks for a rating of an evening out, and promotes the plan ahead when the current plan closes", () => {
    expect(ahead).toMatch(/and mpr\.recipe_id is not null/);
    expect(ahead).toMatch(/update public\.meal_plans set ahead = false where closed_at is null and ahead;/);
  });

  it("keeps who may close and start plans: members only", () => {
    expect(ahead.match(/if not public\.has_permission\('use_modules'\) then/g)).toHaveLength(2);
  });
});

describe("meal plan: a plan is a run of meals (REQ-168)", () => {
  const meals = readMigration("20261005110000");

  it("only adds columns, so the running app keeps working until the new code is live", () => {
    expect(meals).not.toMatch(/drop column/);
    expect(meals).toMatch(/add column starts_meal text not null default 'dinner' check \(starts_meal in \('lunch', 'dinner'\)\)/);
    expect(meals).toMatch(/add column meal_on date,/);
    expect(meals).toMatch(/add column meals integer check \(meals in \(1, 2\)\)/);
  });

  it("puts an entry on a whole meal, and an evening out only on one dinner", () => {
    expect(meals).toMatch(/check \(\(meal_on is null\) = \(meal is null\) and \(meal is null\) = \(meals is null\)\)/);
    expect(meals).toMatch(/check \(not eating_out or meal is null or \(meal = 'dinner' and meals = 1\)\)/);
  });

  it("keeps a plan's days off in their own table that members read, mark and unmark, and nobody signed out sees", () => {
    expect(meals).toMatch(/create table public\.meal_plan_days_off/);
    expect(meals).toMatch(/primary key \(plan_id, day\)/);
    expect(meals).toMatch(/alter table public\.meal_plan_days_off enable row level security;/);
    expect(meals).toMatch(/revoke all on public\.meal_plan_days_off from anon;/);
    for (const action of ["select", "insert", "delete"]) {
      expect(meals).toMatch(new RegExp(`on public\\.meal_plan_days_off for ${action} to authenticated`));
    }
    expect(meals).not.toMatch(/meal_plan_days_off for update/);
  });

  it("converts every plan with the old counting rule, so each dish keeps the meal it shows", () => {
    expect(meals).toMatch(/if \(e\.eating_out or e\.servings = 4\) and slot % 2 = 1 then/);
    expect(meals).toMatch(/taken := case when not e\.eating_out and e\.servings = 4 then 2 else 1 end;/);
    expect(meals).toMatch(/order by position, added_at, id/);
  });

  it("writes a layout as the person asking and refuses two entries on one meal", () => {
    expect(meals).toMatch(/function public\.set_plan_layout\(p_plan uuid, p_starts_on date, p_starts_meal text, p_layout jsonb\)[\s\S]*security invoker/);
    expect(meals).toMatch(/revoke all on function public\.set_plan_layout\(uuid, date, text, jsonb\) from public, anon;/);
    expect(meals).toMatch(/grant execute on function public\.set_plan_layout\(uuid, date, text, jsonb\) to authenticated;/);
    expect(meals).toMatch(/raise exception 'Two entries are on the same meal' using errcode = 'check_violation';/);
  });

  it("starts a plan at dinner unless told otherwise, for members only, without closing anything", () => {
    expect(meals).toMatch(/drop function public\.start_meal_plan\(date\);/);
    expect(meals).toMatch(/function public\.start_meal_plan\(p_starts_on date, p_starts_meal text default 'dinner'\)/);
    expect(meals).toMatch(/if not public\.has_permission\('use_modules'\) then/);
    expect(meals).not.toMatch(/close_meal_plan/);
  });
});

describe("meal plan: Eating out pushes dishes back (REQ-169)", () => {
  const push = readMigration("20261006100000");

  it("only adds: a table of recipes waiting to be proposed, and two functions", () => {
    expect(push).not.toMatch(/drop (column|table|function)/);
    expect(push).toMatch(/create table public\.meal_plan_proposed_next/);
    expect(push).toMatch(/recipe_id uuid primary key references public\.recipes \(id\) on delete cascade/);
  });

  it("lets members read, add and clear proposed recipes, and nobody signed out see them", () => {
    expect(push).toMatch(/alter table public\.meal_plan_proposed_next enable row level security;/);
    expect(push).toMatch(/revoke all on public\.meal_plan_proposed_next from anon;/);
    for (const action of ["select", "insert", "delete"]) {
      expect(push).toMatch(new RegExp(`on public\\.meal_plan_proposed_next for ${action} to authenticated`));
    }
    expect(push).not.toMatch(/meal_plan_proposed_next for update/);
  });

  it("makes the whole push in one step, as the person asking, and refuses two entries on one meal", () => {
    expect(push).toMatch(/function public\.push_plan_back\(p_plan uuid, p_layout jsonb, p_drop uuid\[\], p_eating_out jsonb\)[\s\S]*security invoker/);
    expect(push).toMatch(/revoke all on function public\.push_plan_back\(uuid, jsonb, uuid\[\], jsonb\) from public, anon;/);
    expect(push).toMatch(/grant execute on function public\.push_plan_back\(uuid, jsonb, uuid\[\], jsonb\) to authenticated;/);
    expect(push).toMatch(/raise exception 'Two entries are on the same meal' using errcode = 'check_violation';/);
  });

  it("remembers a dropped dish before taking it off the plan", () => {
    expect(push.indexOf("insert into public.meal_plan_proposed_next")).toBeGreaterThan(-1);
    expect(push.indexOf("insert into public.meal_plan_proposed_next")).toBeLessThan(push.indexOf("delete from public.meal_plan_recipes"));
    expect(push).toMatch(/select recipe_id, 'dropped'/);
  });
});

describe("meal plan: plan lifecycle (REQ-163)", () => {
  const life = readMigration("20261006110000");

  it("gives a plan a status and keeps the old columns, so the running app keeps working", () => {
    expect(life).not.toMatch(/drop column/);
    expect(life).toMatch(/add column status text not null default 'started' check \(status in \('new', 'started', 'closed'\)\)/);
    expect(life).toMatch(/set status = case when closed_at is not null then 'closed' when ahead then 'new' else 'started' end;/);
    expect(life).toMatch(/add column didnt_cook boolean not null default false;/);
    expect(life).toMatch(/set didnt_cook = true where carry_over;/);
  });

  it("starts every plan new, and Start only works on the plan we're on", () => {
    expect(life).toMatch(/values \(p_starts_on, p_starts_meal, \(select auth\.uid\(\)\), current_plan is not null, 'new'\)/);
    expect(life).toMatch(/where id = p_plan and closed_at is null and not ahead and status = 'new';/);
  });

  it("closes a started plan for the schedule (any open plan for a member), counting every dish cooked except those marked, and makes the plan ahead current", () => {
    const close = life.slice(life.indexOf("function public.close_meal_plan_system"), life.indexOf("-- Either of us closes"));
    expect(close).toMatch(/where id = p_plan and closed_at is null and \(status = 'started' or not p_only_started\) for update;/);
    expect(close).toMatch(/not \(mpr\.didnt_cook or mpr\.carry_over\)/);
    expect(close).toMatch(/set cooked = not \(didnt_cook or carry_over\) where plan_id = p_plan;/);
    expect(close).toMatch(/set closed_at = now\(\), status = 'closed' where id = p_plan;/);
    expect(close).toMatch(/update public\.meal_plans set ahead = false where closed_at is null and ahead;/);
  });

  it("keeps the closer that needs nobody signed in away from everyone but the schedule", () => {
    expect(life).toMatch(/revoke all on function public\.close_meal_plan_system\(uuid, boolean\) from public, anon, authenticated;/);
    expect(life).toMatch(/grant execute on function public\.close_meal_plan_system\(uuid, boolean\) to service_role;/);
  });

  it("lets a member close any open plan, as the running app does, while the schedule only closes a started one", () => {
    expect(life).toMatch(/perform public\.close_meal_plan_system\(p_plan, false\);/);
    expect(life).toMatch(/p_only_started boolean default true/);
  });

  it("lets members close, reopen, start and mark Didn't cook this, nobody else", () => {
    expect(life.match(/if not public\.has_permission\('use_modules'\) then/g)).toHaveLength(5);
    expect(life).toMatch(/revoke all on function public\.set_didnt_cook\(uuid, boolean\) from public, anon;/);
    expect(life).toMatch(/grant execute on function public\.set_didnt_cook\(uuid, boolean\) to authenticated;/);
  });

  it("takes a dish's rating questions away when it's marked, and asks the first-time question again when it's taken back", () => {
    const mark = life.slice(life.indexOf("function public.set_didnt_cook"));
    expect(mark).toMatch(/delete from public\.recipe_rating_prompts where recipe_id = v_recipe and plan_id = v_plan;/);
    expect(mark).toMatch(/insert into public\.recipe_rating_prompts \(recipe_id, user_id, plan_id\)/);
  });

  it("logs the start question, and schedules the hourly call with the shared secret", () => {
    expect(life).toMatch(/check \(trigger in \('hourly', 'manual', 'finances', 'meal-plan'\)\)/);
    expect(life).toMatch(/'meal-plan-schedule',\s+--[^\n]*\n\s+'20 \* \* \* \*'/);
    expect(life).toMatch(/\|\| '\/api\/notifications\/meal-plan'/);
    expect(life).toMatch(/where name = 'notify_secret'/);
  });
});

describe("meal plan: lifecycle follow-ups (REQ-163)", () => {
  const follow = readMigration("20261006120000");

  it("remembers who pressed Start, set to the person asking, only on a new plan we're on", () => {
    expect(follow).toMatch(/add column began_by uuid references auth\.users \(id\) on delete set null;/);
    expect(follow).toMatch(/set status = 'started', began_by = \(select auth\.uid\(\)\)/);
    expect(follow).toMatch(/where id = p_plan and closed_at is null and not ahead and status = 'new';/);
    expect(follow).toMatch(/if not public\.has_permission\('use_modules'\) then/);
  });

  it("moves the schedule to the hour, as the same job", () => {
    expect(follow).toMatch(/'meal-plan-schedule',\s+'0 \* \* \* \*'/);
    expect(follow).toMatch(/\|\| '\/api\/notifications\/meal-plan'/);
  });
});

describe("meal plan: repeat recipes setting (REQ-172)", () => {
  const repeat = readMigration("20261006130000");

  it("keeps one household setting, off by default, that only members read and change", () => {
    expect(repeat).toMatch(/id boolean primary key default true check \(id\)/);
    expect(repeat).toMatch(/repeat_recipes boolean not null default false/);
    expect(repeat).toMatch(/insert into public\.meal_plan_settings \(id\) values \(true\);/);
    expect(repeat).toMatch(/alter table public\.meal_plan_settings enable row level security;/);
    expect(repeat).toMatch(/revoke all on public\.meal_plan_settings from anon;/);
    expect(repeat).toMatch(/on public\.meal_plan_settings for select to authenticated\s+using \(\(select public\.is_member\(\)\)\)/);
    expect(repeat).toMatch(/on public\.meal_plan_settings for update to authenticated\s+using \(\(select public\.has_permission\('use_modules'\)\)\)/);
    expect(repeat).not.toMatch(/meal_plan_settings for (insert|delete)/);
  });

  it("lets a recipe be in a plan more than once, by dropping the one-per-plan rule", () => {
    expect(repeat).toMatch(/drop constraint meal_plan_recipes_plan_recipe_key;/);
  });
});

describe("restaurants migration (REQ-90, REQ-129)", () => {
  const restaurants = readMigration("20260929100000");

  // Google's terms: the place ID is the one thing from Google we may keep.
  it("keeps only Google's place ID for a place, once, with who added it and when", () => {
    expect(restaurants).toMatch(/google_place_id text not null unique check/);
    expect(restaurants).toMatch(/added_by uuid references auth\.users \(id\) on delete set null default auth\.uid\(\)/);
    expect(restaurants).toMatch(/created_at timestamptz not null default now\(\)/);
    const columns = /create table public\.restaurants \(([\s\S]*?)\n\);/.exec(restaurants)![1];
    expect(columns.match(/^\s+[a-z_]+ (uuid|text|timestamptz)/gm)).toHaveLength(4);
  });

  it("lets either member see, add in their own name, and remove; nobody signed out", () => {
    expect(restaurants).toMatch(/enable row level security/);
    expect(restaurants).toMatch(/revoke all on public\.restaurants from anon/);
    for (const action of ["select", "insert", "delete"]) {
      expect(restaurants).toMatch(new RegExp(`on public\\.restaurants for ${action} to authenticated`));
    }
    expect(restaurants).toMatch(/with check \(\(select public\.has_permission\('use_modules'\)\) and added_by = \(select auth\.uid\(\)\)\)/);
    expect(restaurants).not.toMatch(/for update/);
  });
});

// REQ-148: months added later. The live check is
// supabase/checks/months_added_later.sql, against the hosted project.
describe("months added later", () => {
  const added = readMigration("20261001100000");

  it("adds only an earlier month of this budget year, never one already there", () => {
    expect(added).toMatch(/starts >= date_trunc\('month', p_today\)::date or starts < public\.budget_year_start\(p_today\)/);
    expect(added).toMatch(/make_date\(\s*extract\(year from p_today\)::integer - case when extract\(month from p_today\) < 4 then 1 else 0 end,\s*4, 1\)/);
    expect(added).toMatch(/if exists \(select 1 from public\.months where starts_on = starts\) then\s+raise exception 'That month is already there'/);
  });

  it("gives it its own split: the one in force then, else today's, and never touches the household's", () => {
    expect(added).toMatch(/where effective_from <= starts order by effective_from desc limit 1;\s+if the_split is null then/);
    expect(added).toMatch(/insert into public\.month_shares \(month_id, user_id, percent\)\s+select the_month, user_id, percent from public\.split_shares/);
    expect(added).not.toMatch(/insert into public\.splits|update public\.splits|delete from public\.split_shares/);
  });

  it("lets its split change only while it's open, and only to 100", () => {
    expect(added).toMatch(/if total <> 100 then/);
    expect(added).toMatch(/where id = p_month and added_later and closed_at is null\s+for update;/);
    expect(added).toMatch(/raise exception 'Give everyone in the household a percentage, once each'/);
  });

  it("divides an open month by its own split when it has one", () => {
    expect(added).toMatch(/where ms\.month_id = p_month and the_month\.closed_at is null and own/);
    expect(added).toMatch(/where the_month\.closed_at is null and not own/);
  });

  it("settles with every bill entered and nobody owing anything", () => {
    expect(added).toMatch(/raise exception 'Enter every bill before settling the month'/);
    expect(added).toMatch(/select p_month, b\.user_id, b\.percent, 0 from public\.month_balances\(p_month\) b/);
    expect(added).toMatch(/if the_month\.id is null or not the_month\.added_later or the_month\.closed_at is not null then/);
  });

  it("is open to either member, and its shares are written only by these functions", () => {
    for (const fn of ["add_past_month(date, date)", "set_month_split(uuid, jsonb)", "settle_past_month(uuid)"]) {
      expect(added).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
    expect(added.match(/has_permission\('use_modules'\)/g)).toHaveLength(3);
    expect(added).not.toMatch(/on public\.month_shares for (insert|update|delete|all)/);
  });
});

describe("module switches (REQ-141, REQ-142, REQ-143)", () => {
  const switches = readMigration("20261002100000");

  it("keeps which modules are off as data only the admin changes", () => {
    expect(switches).toMatch(/create table public\.modules_off \(\s*module text primary key/);
    expect(switches).toMatch(/select id, 'manage_modules' from public\.roles where name = 'Admin';/);
    expect(switches.match(/has_permission\('manage_modules'\)/g)).toHaveLength(3);
    expect(switches).not.toMatch(/on public\.modules_off for update/);
  });

  it("keeps each person's hidden modules to themselves", () => {
    expect(switches).toMatch(/create table public\.modules_hidden/);
    expect(switches.match(/user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(3);
  });

  it("never deletes or changes any module's data", () => {
    const writes = switches.match(/(?:insert into|delete from|update|drop table|truncate) public\.\w+/g) ?? [];
    expect(new Set(writes)).toEqual(
      new Set(["insert into public.role_permissions", "update public.households", "insert into public.modules_off"]),
    );
  });

  it("counts the household that already exists as chosen, and lets a new one choose once", () => {
    expect(switches).toMatch(/add column modules_chosen boolean not null default false;\s+update public\.households set modules_chosen = true;/);
    expect(switches).toMatch(/update public\.households set modules_chosen = true where modules_chosen = false;\s+if not found then/);
    expect(switches).toContain("grant execute on function public.choose_modules(text[]) to authenticated;");
  });
});

// REQ-160: a removed device leaves a mark so the quiet sign-up can't put it back.
describe("removed devices migration", () => {
  const removed = readMigration("20261007100000");

  it("keeps a one-way hash of the address, not the address", () => {
    expect(removed).toMatch(/create table public\.removed_devices \(\s*endpoint_hash text primary key/);
    expect(removed).not.toMatch(/endpoint text/);
  });

  it("is closed to everyone but the secret key", () => {
    expect(removed).toMatch(/alter table public\.removed_devices enable row level security/);
    expect(removed).toMatch(/revoke all on public\.removed_devices from anon, authenticated/);
    expect(removed).not.toMatch(/create policy/);
  });

  it("goes with the person when they leave the household", () => {
    expect(removed).toMatch(/references public\.household_members \(user_id\) on delete cascade/);
  });
});
