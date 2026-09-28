import { describe, expect, it } from "vitest";
import { applyFilter, filterFrom, filterOptions } from "./filter";
import { beenTo } from "./restaurants";

// Invented places; only what the filter looks at.
const shown = [
  { id: "a", place: { neighborhood: "Mission", cuisine: "Mexican" } },
  { id: "b", place: { neighborhood: "Mission", cuisine: null } },
  { id: "c", place: { neighborhood: "Lower East Side", cuisine: "Mexican" } },
  { id: "d", place: null },
];

describe("filtering places by neighbourhood and cuisine (REQ-135)", () => {
  it("offers each neighbourhood and cuisine once, in order, and nothing Google left out", () => {
    expect(filterOptions(shown)).toEqual({ areas: ["Lower East Side", "Mission"], cuisines: ["Mexican"] });
  });

  it("keeps only places matching every filter set; none set keeps them all", () => {
    const ids = (filter: Parameters<typeof applyFilter>[1]) => applyFilter(shown, filter).map((item) => item.id);
    expect(ids({})).toEqual(["a", "b", "c", "d"]);
    expect(ids({ area: "Mission" })).toEqual(["a", "b"]);
    expect(ids({ cuisine: "Mexican" })).toEqual(["a", "c"]);
    expect(ids({ area: "Mission", cuisine: "Mexican" })).toEqual(["a"]);
  });

  it("reads one value of each from the address and ignores the rest", () => {
    expect(filterFrom({ area: "Mission", cuisine: "" })).toEqual({ area: "Mission", cuisine: undefined });
    expect(filterFrom({ area: ["Mission", "Soho"] })).toEqual({ area: undefined, cuisine: undefined });
  });
});

describe("Been to's order (REQ-134)", () => {
  it("is the tried places only, most recently tried first", () => {
    const rows = [
      { id: "new-untried", tried_on: null },
      { id: "sept-12", tried_on: "2026-09-12" },
      { id: "sept-25", tried_on: "2026-09-25" },
    ];
    expect(beenTo(rows).map((row) => row.id)).toEqual(["sept-25", "sept-12"]);
  });
});
