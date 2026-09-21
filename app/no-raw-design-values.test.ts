import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readRules, readTokens } from "../test/css";

// The design's rule for code: colours, corner sizes and fonts come from
// tokens (docs/design/tokens.css), never from raw values, so changing a
// token changes every screen. A reviewer can miss a stray "#888"; this
// test reads every stylesheet and component the app ships and lists each
// raw value it finds, and each token name that doesn't exist.

const SCAN_DIRS = ["app", "components", "lib"];
// The app card is read by the phone, not by a stylesheet, so it can't
// name a token and has to spell its colours out.
const EXEMPT = ["app/manifest.ts"];

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
const LENGTH = /\d(?:px|rem|em|pt)\b/;
// A token reference with a complete name. Names built at run time, like
// `var(--${module}-loud)`, can't be checked here and are skipped.
const TOKEN_REFERENCE = /var\(\s*(--[\w-]+)(?=[\s,)])/g;

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((entry) => {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    const isSource = /\.(css|ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry);
    return isSource ? [full] : [];
  });
}

function rawValuesInCss(css: string): string[] {
  const found: string[] = [];
  for (const { declarations } of readRules(css)) {
    for (const [property, value] of declarations) {
      const raw =
        RAW_COLOUR.test(value.replace(/url\([^)]*\)/g, "")) ||
        ((property === "font-size" || property.endsWith("radius")) && LENGTH.test(value)) ||
        (property === "font-family" && !/^(?:var\(--[\w-]+\)|inherit)$/.test(value)) ||
        (property === "font" && value !== "inherit" && (LENGTH.test(value) || /["']/.test(value)));
      if (raw) found.push(`${property}: ${value}`);
    }
  }
  return found;
}

// In components the raw values to catch are a string that is nothing but
// a colour ("#888", as a style or an SVG fill) and a font or corner size
// in a style object that isn't a token.
function rawValuesInCode(source: string): string[] {
  const colour = /(["'`])\s*(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^"'`]*\))\s*\1/;
  const sizeOrFont = /\b(?:fontSize|fontFamily|border\w*Radius)\s*:(?!\s*["'`]var\()/;
  return source
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => colour.test(line) || sizeOrFont.test(line))
    .map(({ line, number }) => `line ${number}: ${line}`);
}

function tokenReferences(source: string): string[] {
  return [...source.matchAll(TOKEN_REFERENCE)].map((match) => match[1]);
}

describe("the raw-value check itself", () => {
  it("catches raw colours, font sizes, fonts and corner sizes in CSS", () => {
    const css = `.a { color: #888; border-radius: 12px; font-size: 0.75rem;
      font-family: Arial, sans-serif; background: rgba(0, 0, 0, 0.5); }`;
    expect(rawValuesInCss(css)).toHaveLength(5);
  });

  it("lets token values and everything else in CSS through", () => {
    const css = `/* was #888 */ .a { color: var(--color-ink); border-radius: var(--radius-md);
      font-size: var(--text-body); font-family: var(--font-body); font: inherit;
      border: 1px solid var(--color-line); padding: 12px; }`;
    expect(rawValuesInCss(css)).toEqual([]);
  });

  it("catches raw colours and sizes in components", () => {
    const code = `<p style={{ color: "#888" }} />
      <p style={{ fontSize: "12px" }} />
      <p style={{ borderRadius: 8 }} />
      <rect fill="#B23A2B" />`;
    expect(rawValuesInCode(code)).toHaveLength(4);
  });

  it("lets token values, links to a page section and prose through", () => {
    const code = `<p style={{ color: "var(--color-muted)", fontSize: "var(--text-caption)" }} />
      <a href="#main">Skip</a> {"Fixed in #100"}
      <span style={{ background: \`var(--\${slug}-loud)\` }} />`;
    expect(rawValuesInCode(code)).toEqual([]);
  });

  it("reads complete token names and skips ones built at run time", () => {
    expect(tokenReferences("color: var(--color-ink); fill: var(--x, red)")).toEqual([
      "--color-ink",
      "--x",
    ]);
    expect(tokenReferences("`var(--${slug}-loud)` `var(--finances-${part})`")).toEqual([]);
  });
});

describe("app stylesheets and components", () => {
  const files = SCAN_DIRS.flatMap((dir) => sourceFiles(join(REPO_ROOT, dir)))
    .map((file) => relative(REPO_ROOT, file))
    .filter((file) => !EXEMPT.includes(file));

  it("include the base stylesheet and the pages", () => {
    expect(files).toContain("app/globals.css");
    expect(files).toContain("app/page.tsx");
  });

  it("use tokens, never raw colours, font sizes, fonts or corner sizes", () => {
    const offenders = files.flatMap((file) => {
      const source = readFileSync(join(REPO_ROOT, file), "utf-8");
      const found = file.endsWith(".css") ? rawValuesInCss(source) : rawValuesInCode(source);
      return found.map((value) => `${file} → ${value}`);
    });
    expect(offenders, "use a token from docs/design/tokens.css instead").toEqual([]);
  });

  // A misspelt token fails without a sound. Checked in a browser: the
  // property resets, so a background goes transparent and a text colour
  // takes its parent's, even over an earlier rule that set one.
  it("name only tokens that exist", () => {
    const defined = new Set(readTokens().keys());
    for (const file of files) {
      const source = readFileSync(join(REPO_ROOT, file), "utf-8");
      if (file.endsWith(".css")) {
        for (const rule of readRules(source)) {
          for (const property of rule.declarations.keys()) {
            if (property.startsWith("--")) defined.add(property);
          }
        }
      } else {
        // Set from code, like lib/modules.ts's { "--module-loud": … }.
        for (const match of source.matchAll(/["'](--[\w-]+)["']\s*:/g)) defined.add(match[1]);
      }
    }
    const unknown = files.flatMap((file) =>
      tokenReferences(readFileSync(join(REPO_ROOT, file), "utf-8"))
        .filter((name) => !defined.has(name))
        .map((name) => `${file} → ${name}`),
    );
    expect(unknown).toEqual([]);
  });
});
