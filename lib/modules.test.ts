import { describe, expect, it } from "vitest";
import { readTokens } from "../test/css";
import { MODULES, moduleBySlug, moduleColours } from "./modules";

const tokens = readTokens();

describe("the module list", () => {
  it("has the six modules of DESIGN.md, in its order", () => {
    expect(MODULES.map((module) => module.name)).toEqual([
      "Finances",
      "Calendar",
      "Pets",
      "Wine",
      "Meal Plans",
      "Health",
    ]);
  });

  // A decision of 2026-09-21: v0.2 lists all six, and only Finances opens.
  it("opens only Finances, at /finances", () => {
    expect(MODULES.filter((module) => module.href).map((module) => module.href)).toEqual([
      "/finances",
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

  it("finds a module by its slug, and refuses one that doesn't exist", () => {
    expect(moduleBySlug("finances").name).toBe("Finances");
    expect(() => moduleBySlug("storage")).toThrow("No module called storage");
  });
});

describe("the Finances sections", () => {
  const finances = moduleBySlug("finances");

  it("are the seven of the design, in its order", () => {
    expect(finances.sections.map((section) => section.name)).toEqual([
      "Monthly entry",
      "Log payment",
      "Income",
      "Savings",
      "Balances",
      "History",
      "Budget year",
    ]);
  });

  it("mark only Budget year as admin-only", () => {
    expect(
      finances.sections.filter((section) => section.adminOnly).map((section) => section.name),
    ).toEqual(["Budget year"]);
  });
});
