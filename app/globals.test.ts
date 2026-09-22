import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRules } from "../test/css";

// The base styles every page starts from (app/globals.css). A browser
// check confirmed these produce the design's fonts on a real page; these
// tests keep the stylesheet saying so.

const rules = readRules(readFileSync(join(__dirname, "globals.css"), "utf-8"));

// What the stylesheet sets for an element, later rules winning, as they
// do in the browser for selectors as plain as these.
function stylesFor(element: string): Map<string, string> {
  const styles = new Map<string, string>();
  for (const rule of rules) {
    if (rule.selector.split(",").map((part) => part.trim()).includes(element)) {
      for (const [property, value] of rule.declarations) styles.set(property, value);
    }
  }
  return styles;
}

describe("every page", () => {
  it("sets body text in the body font, in ink, on the warm-white ground", () => {
    const body = stylesFor("body");
    expect(body.get("font-family")).toBe("var(--font-body)");
    expect(body.get("color")).toBe("var(--color-ink)");
    expect(body.get("background")).toBe("var(--color-ground)");
  });

  // Found in review of #120: a page one screen tall scrolled by the
  // browser's default 8 px margin, top and bottom.
  it("leaves no browser margin around the page", () => {
    expect(stylesFor("body").get("margin")).toBe("0");
  });

  it.each(["h1", "h2", "h3", "h4", "h5", "h6"])(
    "sets %s in the display font at weight 800",
    (heading) => {
      const styles = stylesFor(heading);
      expect(styles.get("font-family")).toBe("var(--font-display)");
      expect(styles.get("font-weight")).toBe("800");
    },
  );

  it.each(["button", "input", "select", "textarea"])(
    "makes %s use the page's font rather than the browser's own",
    (control) => {
      expect(stylesFor(control).get("font")).toBe("inherit");
    },
  );
});
