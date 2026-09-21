import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readTokens } from "../test/css";

// The design handoff lives in docs/design/, and tokens.css there is the
// one place the app's colours, fonts, corner sizes and spacing are
// written down (DESIGN.md). These tests hold the tokens to the design's
// own rules, so a colour change that breaks one fails here rather than
// being noticed on a phone.

const DESIGN_DIR = join(REPO_ROOT, "docs", "design");
const tokens = readTokens();

function token(name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`tokens.css has no ${name}`);
  return value;
}

// WCAG contrast ratio: how far apart two colours' brightness is, from 1
// (identical) to 21 (black on white). Ordinary text needs at least 4.5.
function luminance(hex: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new Error(`contrast needs a six-digit colour like #1B1824, got ${hex}`);
  }
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Every module named in tokens.css, found by its loud colour, so a module
// added later is checked without anyone remembering to add it here.
const modules = [...tokens.keys()]
  .map((name) => name.match(/^--([a-z]+)-loud$/)?.[1])
  .filter((name): name is string => name !== undefined);

describe("the design reference", () => {
  it("is in the repo: rules, tokens, icon and mockups", () => {
    for (const file of ["DESIGN.md", "tokens.css", "icon.svg"]) {
      expect(existsSync(join(DESIGN_DIR, file)), file).toBe(true);
    }
    const mockups = readdirSync(join(DESIGN_DIR, "mockups"));
    expect(mockups.filter((name) => name.endsWith(".html")).length).toBeGreaterThan(0);
  });
});

describe("the contrast measure these tests rely on", () => {
  it("gives the known answers at both ends of the scale", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBe(1);
  });
});

describe("module colours", () => {
  it("covers the six modules in DESIGN.md", () => {
    expect(modules).toEqual(["finances", "calendar", "pets", "wine", "meals", "health"]);
  });

  it("gives every module a loud set and a quiet set", () => {
    for (const module of modules) {
      for (const part of ["loud", "on-loud", "quiet", "quiet-line", "quiet-ink", "quiet-title"]) {
        expect(tokens.has(`--${module}-${part}`), `--${module}-${part}`).toBe(true);
      }
    }
  });

  // DESIGN.md §3: some modules take dark ink on their loud colour because
  // white would be too faint. Whichever it is, on-loud has to be readable.
  it("makes text on a loud colour readable: at least 4.5 to 1", () => {
    for (const module of modules) {
      const ratio = contrast(token(`--${module}-on-loud`), token(`--${module}-loud`));
      expect(ratio, `${module} on-loud`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("makes text on a quiet tile readable: at least 4.5 to 1", () => {
    for (const module of modules) {
      for (const part of ["quiet-ink", "quiet-title"]) {
        const ratio = contrast(token(`--${module}-${part}`), token(`--${module}-quiet`));
        expect(ratio, `${module} ${part}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("everyday text", () => {
  // Each pair is a text colour and the surface the design puts it on.
  const pairs: Array<[string, string]> = [
    ["--color-ink", "--color-ground"],
    ["--color-ink", "--color-surface"],
    ["--color-muted", "--color-ground"],
    ["--color-muted", "--color-surface"],
    ["--color-muted", "--color-track"],
    ["--color-on-panel", "--color-panel"],
    ["--color-on-panel-muted", "--color-panel"],
    ["--color-success", "--color-success-bg"],
    ["--color-danger", "--color-danger-bg"],
    ["--color-info", "--color-info-bg"],
  ];

  it.each(pairs)("%s on %s is at least 4.5 to 1", (text, surface) => {
    expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
  });
});
