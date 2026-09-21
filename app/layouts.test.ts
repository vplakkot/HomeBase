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
    ["components/module-tile.module.css", "status", "a tile's status line", true, false],
    ["components/module-tile.module.css", "headline", "a tile's headline", false, true],
    ["components/module-tile.module.css", "facts", "a tile's two facts", false, true],
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

// DESIGN.md §4: on a phone, Quick add is fixed at the bottom and the tiles
// scroll under it. The frame is pinned to the screen and never scrolls;
// the main area is the one thing that does, and the bar sits below it in
// the frame's column (components/app-frame.test.tsx checks that order).
// So scrolling moves the tiles and leaves the bar where it is. A browser
// check on 2026-09-21 confirmed it: after scrolling, the bar's top edge
// hadn't moved and the last tile had come up from under it.
describe("a phone's Quick add bar", () => {
  const frameCss = css("components/app-frame.module.css");
  const style = (className: string) => styleOf(frameCss, className, false);

  it("sits in a frame pinned to the screen, which doesn't scroll", () => {
    expect(style("frame").get("position")).toBe("fixed");
    expect(style("frame").get("inset")).toBe("0");
    expect(style("frame").has("overflow")).toBe(false);
    expect(style("column").get("flex-direction")).toBe("column");
  });

  it("stays put while the page above it scrolls", () => {
    expect(style("main").get("overflow-y")).toBe("auto");
    // Without these the page would grow past the screen and push the bar
    // off the bottom instead of scrolling above it.
    expect(style("main").get("flex")).toBe("1");
    expect(style("main").get("min-height")).toBe("0");
    expect(style("phoneBar").get("flex-shrink")).toBe("0");
  });
});
