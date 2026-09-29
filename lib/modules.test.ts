import { describe, expect, it } from "vitest";
import { readTokens } from "../test/css";
import {
  SAVINGS_PAUSED,
  MODULES,
  SWITCHES,
  EVERYTHING_ON,
  isOn,
  moduleBySlug,
  moduleColours,
  modulesOn,
  modulesShown,
  modulesUnder,
} from "./modules";

const tokens = readTokens();

describe("the module list", () => {
  it("has the nine modules of DESIGN.md, in its order", () => {
    expect(MODULES.map((module) => module.name)).toEqual([
      "Finances",
      "Calendar",
      "Pets",
      "Drinks",
      "Meal Plans",
      "Health",
      "Paperwork",
      "Storage",
      "Restaurants",
    ]);
  });

  // A decision of 2026-09-21: v0.2 listed all six, and only Finances
  // opened. v1.0 adds Paperwork and Storage, which open too; v2.0 Drinks;
  // v2.1 Restaurants.
  it("opens Finances, Drinks, Meal Plans, Paperwork, Storage and Restaurants, at their own addresses", () => {
    expect(MODULES.filter((module) => module.href).map((module) => module.href)).toEqual([
      "/finances",
      "/drinks",
      "/meal-plans",
      "/paperwork",
      "/storage",
      "/restaurants",
    ]);
  });

  it("gives every module a slug of its own", () => {
    const slugs = MODULES.map((module) => module.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // A module whose colours are misspelt would draw with none at all, and
  // the browser wouldn't say a word. So every colour a module will ask
  // for must exist, and every module in tokens.css must be in the list.
  it("names colour tokens that exist, all six for every module", () => {
    for (const module of MODULES) {
      for (const value of Object.values(moduleColours(module))) {
        const name = value.match(/^var\((--[\w-]+)\)$/)?.[1];
        expect(name && tokens.has(name), `${module.name}: ${value}`).toBe(true);
      }
    }
  });

  it("covers every module tokens.css has colours for", () => {
    const coloured = [...tokens.keys()]
      .map((name) => name.match(/^--([a-z]+)-loud$/)?.[1])
      .filter(Boolean);
    expect(MODULES.map((module) => module.tokens).sort()).toEqual(coloured.sort());
  });

  // REQ-141: one switch per module, except Paperwork and Storage, which
  // share one because archived paperwork files live in Storage.
  it("has one switch per module, Paperwork & Storage sharing one", () => {
    expect(SWITCHES.map((each) => each.name)).toEqual([
      "Finances",
      "Calendar",
      "Pets",
      "Drinks",
      "Meal Plans",
      "Health",
      "Paperwork & Storage",
      "Restaurants",
    ]);
    expect(modulesUnder(["paperwork"])).toEqual(["paperwork", "storage"]);
  });

  it("leaves out the modules that are off, and only those, from what's on", () => {
    const view = { off: ["pets", "drinks"], hidden: [] };
    expect(modulesOn(view).map((module) => module.name)).toEqual([
      "Finances",
      "Calendar",
      "Meal Plans",
      "Health",
      "Paperwork",
      "Storage",
      "Restaurants",
    ]);
    expect(isOn(view, "pets")).toBe(false);
    expect(isOn(view, "finances")).toBe(true);
  });

  // REQ-143: hidden is yours alone, and only leaves what you're shown.
  it("keeps a hidden module on, but out of what you're shown", () => {
    const view = { off: [], hidden: ["drinks"] };
    expect(modulesOn(view).map((module) => module.slug)).toContain("drinks");
    expect(modulesShown(view).map((module) => module.slug)).not.toContain("drinks");
  });

  it("shows everything when nothing is off or hidden", () => {
    expect(modulesShown(EVERYTHING_ON)).toEqual(MODULES);
  });

  it("finds a module by its slug, and refuses one that doesn't exist", () => {
    expect(moduleBySlug("finances").name).toBe("Finances");
    expect(() => moduleBySlug("garage")).toThrow("No module called garage");
  });
});

describe("the Finances sections", () => {
  const finances = moduleBySlug("finances");

  it("are the design's tabs in its order, Log payment pinned (DESIGN.md §7)", () => {
    expect(finances.sections.map((section) => section.name)).toEqual([
      "Monthly entry",
      "Log payment",
      "Payments",
      "Income",
      "Savings",
      "Balances",
      "History",
    ]);
  });

  it("have no admin-only tab: Budget year sits behind the settings gear (REQ-103)", () => {
    expect(finances.sections.some((section) => section.adminOnly)).toBe(false);
    expect(finances.sections.some((section) => section.name === "Budget year")).toBe(false);
  });

  it("hide Savings while savings is paused", () => {
    expect(SAVINGS_PAUSED).toBe(true);
    expect(finances.sections.find((section) => section.name === "Savings")?.hidden).toBe(true);
  });
});
