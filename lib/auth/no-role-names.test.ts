import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Access decisions ask for a permission, never for a role's name. Role
// names are data (rows in the roles table); if app code compared against
// them, adding a role would mean editing code. This test scans the app for
// any such comparison.
const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "lib", "proxy.ts"];
const ROLE_NAME_LITERAL = /["'`](Admin|Member)["'`]/;

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) {
    return [path];
  }
  return readdirSync(path).flatMap((entry) => {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    const isSource = /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry);
    return isSource ? [full] : [];
  });
}

describe("app code", () => {
  const files = SCAN_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)));

  it("scans a meaningful number of source files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("never compares against a role name", () => {
    const offenders = files
      .filter((file) => ROLE_NAME_LITERAL.test(readFileSync(file, "utf-8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
