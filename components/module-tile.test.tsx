// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT, styleOf } from "../test/css";
import type { ModuleStatus } from "../lib/module-status";
import { MODULES, moduleBySlug } from "../lib/modules";
import { MODULE_ICONS } from "./icons";
import { ModuleTile } from "./module-tile";
import styles from "./module-tile.module.css";

afterEach(cleanup);

const css = readFileSync(join(REPO_ROOT, "components/module-tile.module.css"), "utf-8");

const calm: ModuleStatus = {
  status: "9 bottles",
  headline: "9 bottles on the rack",
  facts: [
    { label: "Opened this month", value: "3" },
    { label: "Running low", value: "Red blends" },
  ],
  actionItems: [],
};
const needsYou: ModuleStatus = {
  ...calm,
  actionItems: [{ text: "Heartworm pill due", detail: "Both dogs, today", rank: 1 }],
};

function tileFor(slug: string, status: ModuleStatus): HTMLElement {
  const { container } = render(<ModuleTile module={moduleBySlug(slug)} status={status} />);
  return container.firstElementChild as HTMLElement;
}

function part(tile: HTMLElement, className: string): HTMLElement | null {
  return tile.querySelector(`.${className}`);
}

describe("a module tile's colour", () => {
  // The tile draws with --tile-* colours; .tile sets them to the module's
  // quiet ones and .loud to its loud ones.
  const tile = styleOf(css, "tile", false);
  const loud = styleOf(css, "loud", false);

  it("draws its background, border and text in the --tile-* colours", () => {
    expect(tile.get("background")).toBe("var(--tile-ground)");
    expect(tile.get("border")).toBe("1px solid var(--tile-line)");
    expect(tile.get("color")).toBe("var(--tile-title)");
  });

  it("is quiet, with the module's tint, border and ink, when it has no action items", () => {
    const element = tileFor("pets", calm);
    expect(element.classList.contains(styles.loud)).toBe(false);
    expect(tile.get("--tile-ground")).toBe("var(--module-quiet)");
    expect(tile.get("--tile-line")).toBe("var(--module-quiet-line)");
    expect(tile.get("--tile-title")).toBe("var(--module-quiet-title)");
    expect(tile.get("--tile-ink")).toBe("var(--module-quiet-ink)");
  });

  it("is loud, in the module's solid colour with on-loud text, when it has an action item", () => {
    const element = tileFor("pets", needsYou);
    expect(element.classList.contains(styles.loud)).toBe(true);
    expect(loud.get("--tile-ground")).toBe("var(--module-loud)");
    expect(loud.get("--tile-line")).toBe("var(--module-loud)");
    expect(loud.get("--tile-title")).toBe("var(--module-on-loud)");
    expect(loud.get("--tile-ink")).toBe("var(--module-on-loud)");
  });

  it("uses its own module's colours, loud or quiet", () => {
    const element = tileFor("wine", needsYou);
    expect(element.style.getPropertyValue("--module-loud")).toBe("var(--wine-loud)");
    expect(element.style.getPropertyValue("--module-on-loud")).toBe("var(--wine-on-loud)");
    expect(element.style.getPropertyValue("--module-quiet")).toBe("var(--wine-quiet)");
  });
});

describe("what a module tile shows", () => {
  it("has the module's icon in a round chip, and its name", () => {
    const element = tileFor("calendar", calm);
    const chip = part(element, styles.chip)!;
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(styleOf(css, "chip", false).get("border-radius")).toBe("var(--radius-pill)");
    expect(part(element, styles.name)?.textContent).toBe("Calendar");
  });

  it("gives a phone one status line, and a desktop a headline plus two facts", () => {
    const element = tileFor("wine", calm);
    expect(part(element, styles.status)?.textContent).toBe("9 bottles");
    expect(part(element, styles.headline)?.textContent).toBe("9 bottles on the rack");
    const facts = [...element.querySelectorAll(`.${styles.fact}`)].map((fact) => fact.textContent);
    expect(facts).toEqual(["Opened this month3", "Running lowRed blends"]);

    const shown = (className: string, desktop: boolean) =>
      styleOf(css, className, desktop).get("display") !== "none";
    expect([shown("status", false), shown("status", true)]).toEqual([true, false]);
    expect([shown("headline", false), shown("headline", true)]).toEqual([false, true]);
    expect([shown("facts", false), shown("facts", true)]).toEqual([false, true]);
  });

  it("leaves the facts out while the module has none to report", () => {
    const element = tileFor("wine", { ...calm, facts: [] });
    expect(part(element, styles.facts)).toBeNull();
  });

  it("is one link to the module, when the module has pages", () => {
    const element = tileFor("finances", needsYou);
    expect(element.tagName).toBe("A");
    expect(element.getAttribute("href")).toBe("/finances");
    expect(element.querySelectorAll("a")).toHaveLength(0);
  });

  it("is not a link while the module has none", () => {
    const element = tileFor("pets", needsYou);
    expect(element.tagName).toBe("DIV");
    expect(element.querySelector("a")).toBeNull();
  });

  it("has an icon for every module in the list", () => {
    for (const module of MODULES) {
      expect(MODULE_ICONS[module.slug], module.slug).toBeTypeOf("function");
    }
  });
});
