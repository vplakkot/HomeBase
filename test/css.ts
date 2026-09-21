import { readFileSync } from "node:fs";
import { join } from "node:path";

// Just enough CSS reading for tests to ask a stylesheet questions without
// a parsing library: comments dropped, then each rule's declarations as
// property → value. Rules inside a block such as @media are reported
// under their own selector. It assumes our own plain CSS: no semicolons
// or braces inside strings or url().

export const REPO_ROOT = join(__dirname, "..");
export const TOKENS_PATH = join(REPO_ROOT, "docs", "design", "tokens.css");

export type Rule = { selector: string; declarations: Map<string, string> };

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function readRules(css: string): Rule[] {
  const rules: Rule[] = [];
  // An innermost block has no braces inside it, so its body is a list of
  // declarations and the text before it is its selector.
  for (const match of stripComments(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const part of match[2].split(";")) {
      const colon = part.indexOf(":");
      if (colon === -1) continue;
      declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    rules.push({ selector: match[1].trim().replace(/\s+/g, " "), declarations });
  }
  return rules;
}

// Every custom property the file declares on :root, e.g. "--color-ink".
export function readTokens(path = TOKENS_PATH): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const rule of readRules(readFileSync(path, "utf8"))) {
    if (rule.selector !== ":root") continue;
    for (const [name, value] of rule.declarations) {
      if (name.startsWith("--")) tokens.set(name, value);
    }
  }
  return tokens;
}
