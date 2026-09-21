import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readRules, readTokens, styleOf } from "../test/css";

// REQ-18: below 1024 px wide a screen gets the phone layout, from 1024 px
// the desktop one. CSS decides, with a single width, so resizing a window
// switches on the spot. These tests read the stylesheets; a browser check
// confirmed the switch happens between 1023 and 1024 px.

function stylesheets(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((entry) => {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) return stylesheets(full);
    return entry.endsWith(".css") ? [full] : [];
  });
}

function css(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf-8");
}

describe("the switch between phone and desktop", () => {
  it("happens at the width tokens.css names", () => {
    expect(readTokens().get("--breakpoint-desktop")).toBe("1024px");
  });

  // A stylesheet can't read a token inside @media, so every block states
  // the width itself. One value, checked everywhere, is the next best
  // thing to defining it once.
  it("uses that one width everywhere, and nothing else", () => {
    const files = ["app", "components"].flatMap((dir) => stylesheets(join(REPO_ROOT, dir)));
    const conditions = files.flatMap((file) =>
      readRules(readFileSync(file, "utf-8"))
        .filter((rule) => rule.media !== null)
        .map((rule) => `${relative(REPO_ROOT, file)}: ${rule.media}`),
    );
    expect(conditions.length).toBeGreaterThan(0);
    for (const condition of conditions) {
      expect(condition).toMatch(/: \(min-width: 1024px\)$/);
    }
  });
});

describe("what each screen gets", () => {
  it.each([
    // [stylesheet, class, what it is, shown on a phone, shown on a desktop]
    ["components/sidebar.module.css", "sidebar", "the sidebar", false, true],
    ["components/app-frame.module.css", "phoneBar", "the bar at the bottom", true, false],
    ["app/page.module.css", "header", "Home's brand and Admin pill", true, false],
    ["app/page.module.css", "desktopQuickAdd", "Quick add beside the greeting", false, true],
    ["app/admin/page.module.css", "back", "the admin console's way back", true, false],
  ])("%s .%s: %s", (file, className, _what, onPhone, onDesktop) => {
    const shown = (desktop: boolean) =>
      styleOf(css(file), className, desktop).get("display") !== "none";
    expect(shown(false), "on a phone").toBe(onPhone);
    expect(shown(true), "on a desktop").toBe(onDesktop);
  });

  it("lays Home's tiles out in two columns on a phone and three on a desktop", () => {
    const columns = (desktop: boolean) =>
      styleOf(css("app/page.module.css"), "tiles", desktop).get("grid-template-columns");
    expect(columns(false)).toBe("repeat(2, minmax(0, 1fr))");
    expect(columns(true)).toBe("repeat(3, minmax(0, 1fr))");
  });
});
