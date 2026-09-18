import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The workflow applies migration files to the hosted database, so its
// shape is pinned: it must only ever run for main, only when a migration
// changed, with credentials from secrets, and never touch project config.
const workflow = readFileSync(join(__dirname, "migrate.yml"), "utf-8");

describe("migrate.yml", () => {
  it("runs only when a push to main touches a migration file", () => {
    expect(workflow).toMatch(/on:\s*\n\s*push:\s*\n\s*branches: \[main\]\s*\n\s*paths:\s*\n\s*- "supabase\/migrations\/\*\*"/);
    expect(workflow).not.toMatch(/pull_request/);
  });

  it("never runs two applies at once", () => {
    expect(workflow).toMatch(/concurrency:\s*\n\s*group: apply-migrations\s*\n\s*cancel-in-progress: false/);
  });

  it("takes both credentials from repository secrets and nowhere else", () => {
    expect(workflow).toContain("${{ secrets.SUPABASE_ACCESS_TOKEN }}");
    expect(workflow).toContain("${{ secrets.SUPABASE_DB_PASSWORD }}");
    expect(workflow).not.toMatch(/--password\s+"[^$][^"]*"/);
    expect(workflow).not.toMatch(/sbp_[a-z0-9]/);
  });

  it("fails loudly before touching anything if a secret is missing", () => {
    expect(workflow).toMatch(/if \[ -z "\$SUPABASE_ACCESS_TOKEN" \] \|\| \[ -z "\$SUPABASE_DB_PASSWORD" \]/);
    expect(workflow).toContain("exit 1");
  });

  it("pushes migrations to the linked project, and never project config", () => {
    expect(workflow).toMatch(/npx supabase db push --linked/);
    expect(workflow).not.toMatch(/config push/);
  });
});
