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
