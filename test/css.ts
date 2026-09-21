import { readFileSync } from "node:fs";
import { join } from "node:path";

// Just enough CSS reading for tests to ask a stylesheet questions without
// a parsing library: comments dropped, then each rule's selector, its
// declarations as property → value, and the @media condition it sits
// inside, if any. It assumes our own plain CSS: no semicolons or braces
// inside strings or url(), and @media blocks one level deep.

export const REPO_ROOT = join(__dirname, "..");
export const TOKENS_PATH = join(REPO_ROOT, "docs", "design", "tokens.css");

export type Rule = {
  selector: string;
  declarations: Map<string, string>;
  // "(min-width: 1024px)" for a rule inside that @media block, else null.
  media: string | null;
};

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function declarationsOf(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return declarations;
}

export function readRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const text = stripComments(css);
  let media: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      const header = text.slice(start, i).trim().replace(/\s+/g, " ");
      if (header.startsWith("@media")) {
        media = header.slice("@media".length).trim();
        start = i + 1;
        continue;
      }
      const end = text.indexOf("}", i);
      rules.push({ selector: header, declarations: declarationsOf(text.slice(i + 1, end)), media });
      i = end;
      start = end + 1;
    } else if (text[i] === "}") {
      // Only an @media block's own closing brace gets here.
      media = null;
      start = i + 1;
    }
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

// What a stylesheet sets for one class, below the desktop width or from
// it: later rules win, as they do in the browser for rules this plain.
export function styleOf(css: string, className: string, desktop: boolean): Map<string, string> {
  const styles = new Map<string, string>();
  for (const rule of readRules(css)) {
    const inDesktop = rule.media === "(min-width: 1024px)";
    if (rule.media !== null && !inDesktop) continue;
    if (inDesktop && !desktop) continue;
    const selectors = rule.selector.split(",").map((part) => part.trim());
    if (!selectors.includes(`.${className}`)) continue;
    for (const [property, value] of rule.declarations) styles.set(property, value);
  }
  return styles;
}
