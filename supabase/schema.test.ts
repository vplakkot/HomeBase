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

  it("gives each row its own receipt token, and only one row per token", () => {
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
