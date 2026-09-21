import { describe, expect, it } from "vitest";
import { isLoud, moduleStatus, type ModuleStatus } from "./module-status";
import { MODULES } from "./modules";

const quiet: ModuleStatus = { status: "", headline: "", facts: [], actionItems: [] };

describe("loud or quiet", () => {
  it("is loud with at least one action item, and quiet with none", () => {
    expect(isLoud(quiet)).toBe(false);
    expect(isLoud({ ...quiet, actionItems: [{ text: "A", detail: "B" }] })).toBe(true);
    expect(
      isLoud({
        ...quiet,
        actionItems: [
          { text: "A", detail: "B" },
          { text: "C", detail: "D" },
        ],
      }),
    ).toBe(true);
  });
});

// A decision of 2026-09-21: the invented example shows only with ?demo.
describe("what each module says, normally", () => {
  it("is quiet, 'Coming soon' and nothing more, for every module", () => {
    for (const module of MODULES) {
      const status = moduleStatus(module, { demo: false });
      expect(status, module.name).toEqual({
        status: "Coming soon",
        headline: "Coming soon",
        facts: [],
        actionItems: [],
      });
    }
  });
});

describe("what each module says with ?demo", () => {
  const demo = MODULES.map((module) => ({ module, status: moduleStatus(module, { demo: true }) }));

  it("is the mockups' example: Finances, Pets and Health loud, the rest quiet", () => {
    expect(demo.filter(({ status }) => isLoud(status)).map(({ module }) => module.name)).toEqual([
      "Finances",
      "Pets",
      "Health",
    ]);
  });

  it("gives every module its own status line, headline and two facts", () => {
    for (const { module, status } of demo) {
      expect(status.status, module.name).not.toBe("Coming soon");
      expect(status.headline, module.name).not.toBe("");
      expect(status.facts, module.name).toHaveLength(2);
    }
  });
});
