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

  it("sweeps expired invitations away at sign-up, so none accumulate", () => {
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
