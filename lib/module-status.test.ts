import { describe, expect, it } from "vitest";
import {
  demoFrom,
  isLoud,
  moduleStatus,
  mostUrgent,
  type ActionItem,
  type ModuleStatus,
} from "./module-status";
import { MODULES, moduleBySlug } from "./modules";

const quiet: ModuleStatus = { status: "", headline: "", facts: [], actionItems: [] };

function item(rank: number): ActionItem {
  return { text: `Item ${rank}`, detail: "", rank };
}

describe("loud or quiet", () => {
  it("is loud with at least one action item, and quiet with none", () => {
    expect(isLoud(quiet)).toBe(false);
    expect(isLoud({ ...quiet, actionItems: [item(1)] })).toBe(true);
    expect(isLoud({ ...quiet, actionItems: [item(1), item(2)] })).toBe(true);
  });
});

describe("the action items Home shows", () => {
  it("are the three most urgent, most urgent first, whichever module they're from", () => {
    const shown = mostUrgent([
      { module: moduleBySlug("pets"), status: { ...quiet, actionItems: [item(4), item(2)] } },
      { module: moduleBySlug("wine"), status: quiet },
      { module: moduleBySlug("health"), status: { ...quiet, actionItems: [item(5)] } },
      { module: moduleBySlug("finances"), status: { ...quiet, actionItems: [item(1)] } },
    ]);
    expect(shown.map(({ module, item }) => `${module.slug} ${item.rank}`)).toEqual([
      "finances 1",
      "pets 2",
      "pets 4",
    ]);
  });

  it("are all of them when there are three or fewer, and none when there are none", () => {
    const one = [{ module: moduleBySlug("pets"), status: { ...quiet, actionItems: [item(1)] } }];
    expect(mostUrgent(one)).toHaveLength(1);
    expect(mostUrgent([{ module: moduleBySlug("pets"), status: quiet }])).toEqual([]);
  });
});

describe("reading ?demo from the address", () => {
  it("is off without it", () => {
    expect(demoFrom(undefined)).toBeNull();
  });

  it("is the mockups' three items for plain ?demo, or anything that isn't a number", () => {
    expect(demoFrom("")).toBe(3);
    expect(demoFrom("yes")).toBe(3);
  });

  it("takes 0 to 4 items as asked, and no more than 4", () => {
    expect([0, 1, 2, 3, 4].map((n) => demoFrom(String(n)))).toEqual([0, 1, 2, 3, 4]);
    expect(demoFrom("9")).toBe(4);
  });

  it("uses the first when the address repeats it", () => {
    expect(demoFrom(["1", "2"])).toBe(1);
  });
});

// A decision of 2026-09-21: the invented example shows only with ?demo.
describe("what each module says, normally", () => {
  it("is quiet, 'Coming soon' and nothing more, for every module", () => {
    for (const module of MODULES) {
      expect(moduleStatus(module, null), module.name).toEqual({
        status: "Coming soon",
        headline: "Coming soon",
        facts: [],
        actionItems: [],
      });
    }
  });
});

describe("what each module says with ?demo", () => {
  const example = (demo: number) =>
    MODULES.map((module) => ({ module, status: moduleStatus(module, demo) }));
  const loud = (demo: number) =>
    example(demo)
      .filter(({ status }) => isLoud(status))
      .map(({ module }) => module.name);

  it("is the mockups' example: Finances, Pets and Health loud, the rest quiet", () => {
    expect(loud(3)).toEqual(["Finances", "Pets", "Health"]);
    expect(mostUrgent(example(3)).map(({ item }) => item.text)).toEqual([
      "Card bill due Friday",
      "Heartworm pill due",
      "Prescription ready",
    ]);
  });

  it("gives every module its own status line, headline and two facts", () => {
    for (const { module, status } of example(3)) {
      expect(status.status, module.name).not.toBe("Coming soon");
      expect(status.headline, module.name).not.toBe("");
      expect(status.facts, module.name).toHaveLength(2);
    }
  });

  // So each state of the card can be looked at (REQ-83).
  it("keeps only as many items as asked, most urgent first, and tiles follow", () => {
    expect(mostUrgent(example(0))).toEqual([]);
    expect(loud(0)).toEqual([]);
    expect(mostUrgent(example(1)).map(({ module }) => module.name)).toEqual(["Finances"]);
    expect(loud(2)).toEqual(["Finances", "Pets"]);
  });

  it("with four, lights up Calendar too, but its item is too far down for the card", () => {
    expect(loud(4)).toEqual(["Finances", "Calendar", "Pets", "Health"]);
    expect(mostUrgent(example(4)).map(({ module }) => module.name)).toEqual([
      "Finances",
      "Pets",
      "Health",
    ]);
  });
});
