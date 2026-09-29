import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, styleOf } from "../test/css";

// REQ-151: the name of each thing on a page you read sits on a pale band.
const css = readFileSync(join(REPO_ROOT, "components/band.module.css"), "utf-8");
const source = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");

describe("the band (REQ-151)", () => {
  it("is the module's quiet tint and quiet-title ink, the same length whatever its text", () => {
    const band = styleOf(css, "band", false);
    expect(band.get("background")).toBe("var(--module-quiet)");
    expect(band.get("color")).toBe("var(--module-quiet-title)");
    expect(band.get("width")).toBe("min(calc(100% + var(--space-4)), 18rem)");
    expect(band.get("display")).toBe("block");
  });

  it("reaches left by its own padding, so its words line up with the text below", () => {
    const band = styleOf(css, "band", false);
    expect(band.get("margin-left")).toBe("calc(-1 * var(--space-4))");
    expect(band.get("padding")).toBe("var(--space-2) var(--space-4)");
  });

  // Pages you read, in every module that lists things without photos.
  it.each([
    "app/finances/page.tsx",
    "app/finances/payments/page.tsx",
    "app/finances/history/page.tsx",
    "app/meal-plans/page.tsx",
    "app/paperwork/page.tsx",
    "app/paperwork/categories/page.tsx",
    "app/paperwork/file-cards.tsx",
    "app/paperwork/frame.tsx",
    "app/paperwork/unfiled/page.tsx",
    "app/paperwork/files/[id]/page.tsx",
    "app/paperwork/categories/[id]/page.tsx",
    "app/storage/frame.tsx",
    "app/storage/entries/[id]/page.tsx",
    "app/restaurants/place.tsx",
  ])("%s puts names on the band", (path) => {
    expect(source(path)).toMatch(/\bband\.band\b/);
  });

  // Photo tiles and forms stay plain (Vin, 2026-09-28).
  it.each([
    "app/drinks/list.tsx",
    "app/drinks/overview.tsx",
    "app/meal-plans/recipes/page.tsx",
    "app/restaurants/list.tsx",
    "app/finances/monthly-entry/page.tsx",
    "app/finances/budget-year/page.tsx",
    "app/finances/log-payment/page.tsx",
    "app/finances/income/page.tsx",
  ])("%s stays plain", (path) => {
    expect(source(path)).not.toContain("band.module.css");
  });

  it("never sits on a heading", () => {
    for (const path of ["app/finances/page.tsx", "app/paperwork/page.tsx", "app/storage/frame.tsx"]) {
      expect(source(path)).not.toMatch(/<h[1-3][^>]*band\.band/);
    }
  });
});
