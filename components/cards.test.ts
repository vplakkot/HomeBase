import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readRules, styleOf } from "../test/css";

// The shared cards on the module home rules (DESIGN.md §6, REQ-103,
// REQ-106). Every module's pages are built from them.
const css = readFileSync(join(REPO_ROOT, "components/cards.module.css"), "utf-8");
const rules = readRules(css);

describe("the shared cards", () => {
  it("draw each card on the shell background, a 1.5px module border, 20px corners, no shadow", () => {
    const blocks = rules.find((rule) => rule.selector === ".card > :not(.head)")!.declarations;
    expect(blocks.get("border")).toBe("1.5px solid var(--module-loud)");
    expect(blocks.get("background")).toBe("var(--color-ground)");
    const all = rules.find((rule) => rule.selector === ".card > .head + :last-child")!.declarations;
    expect(all.get("border-radius")).toBe("var(--radius-lg)");
    expect(css).not.toMatch(/box-shadow:(?! inset 0 -1px 0 var\(--color-line-soft\))/);
  });

  it("have no tinted, pale or dark fills", () => {
    expect(css).not.toContain("--module-quiet");
    for (const rule of rules) {
      const background = rule.declarations.get("background");
      // The hint's tooltip is the one dark thing, and it floats over the card.
      if (!background || rule.selector === ".info::after") continue;
      const button = rule.selector === ".primary, .quiet";
      expect(background, rule.selector).toBe(button ? "var(--module-loud)" : "var(--color-ground)");
    }
  });

  it("use the module colour only for borders, buttons, focus rings and tick boxes", () => {
    for (const rule of rules) {
      for (const [property, value] of rule.declarations) {
        if (!value.includes("--module-")) continue;
        const allowed =
          property.startsWith("border") ||
          property === "outline" ||
          property === "accent-color" ||
          ((property === "background" || property === "color") && rule.selector === ".primary, .quiet");
        expect(allowed, `${rule.selector} { ${property}: ${value} }`).toBe(true);
      }
    }
  });

  it("make every button the one module button: solid, white text, 44px, 16px corners", () => {
    for (const name of ["primary", "quiet"]) {
      const button = styleOf(css, name, false);
      expect(button.get("background")).toBe("var(--module-loud)");
      expect(button.get("color")).toBe("var(--module-on-loud)");
      expect(button.get("min-height")).toBe("44px");
      expect(button.get("border-radius")).toBe("var(--radius-md)");
      expect(button.get("font-weight")).toBe("600");
      expect(button.get("border")).toBe("0");
    }
  });

  it("show a status as plain text, never a chip", () => {
    const status = styleOf(css, "status", false);
    expect(status.has("background")).toBe(false);
    expect(status.has("border-radius")).toBe(false);
    expect(status.has("padding")).toBe(false);
    expect(css).not.toMatch(/\.chip\b/);
  });

  it("sit inputs on the shell background with a grey line", () => {
    const input = rules.find((rule) => rule.selector.startsWith(".field input"))!.declarations;
    expect(input.get("background")).toBe("var(--color-ground)");
    expect(input.get("border")).toBe("1px solid var(--color-line)");
  });

  // A hint only a mouse can reach isn't a hint (#133).
  it("show a card's hint on keyboard focus, not only on hover", () => {
    expect(css).toMatch(/\.info:hover::after,\s*\.info:focus-visible::after \{\s*display: block;/);
    expect(css).toMatch(/content: attr\(data-hint\)/);
  });
});
