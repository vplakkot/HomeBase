import { describe, expect, it } from "vitest";
import { contentLines, contentsPreview, entryId, searchEntries, storageTile, type StorageEntry } from "./storage";

// An invented basement; nothing here is real.
const entry = (number: number, name: string, is_box: boolean, contents: string | null = null, note: string | null = null): StorageEntry => ({
  id: `s-${number}`,
  number,
  name,
  is_box,
  contents,
  note,
});
const ENTRIES = [
  entry(1, "Suitcases", false),
  entry(2, "Christmas tree", false),
  entry(3, "Shoes", true, "Ski boots\nHiking boots\nSandals\nWellies"),
  entry(4, "Seasonal clothes", true, null, "winter clothes in summer, summer clothes in winter"),
];

describe("an entry's ID (REQ-87)", () => {
  it("is S- and its number in three digits", () => {
    expect(entryId({ number: 3 })).toBe("S-003");
    expect(entryId({ number: 1234 })).toBe("S-1234");
  });
});

describe("a box's contents (REQ-87)", () => {
  it("are one item per line, blank lines dropped", () => {
    expect(contentLines({ contents: "Ski boots\n\n  Sandals \n" })).toEqual(["Ski boots", "Sandals"]);
    expect(contentLines({ contents: null })).toEqual([]);
  });

  it("preview as the first three, and how many more", () => {
    expect(contentsPreview(ENTRIES[2])).toBe("Ski boots, Hiking boots, Sandals, and 1 more");
    expect(contentsPreview({ contents: "Tent" })).toBe("Tent");
    expect(contentsPreview(ENTRIES[0])).toBeNull();
  });
});

describe("searching Storage (REQ-87)", () => {
  const names = (query: string) => searchEntries(ENTRIES, query).map((row) => row.name);

  it("finds the box something is in by its contents", () => {
    expect(names("ski boots")).toEqual(["Shoes"]);
  });

  it("finds by ID however it's typed", () => {
    for (const typed of ["S-003", "s3", "3", "S003"]) expect(names(typed), typed).toEqual(["Shoes"]);
  });

  it("finds by name or note, ignoring case", () => {
    expect(names("TREE")).toEqual(["Christmas tree"]);
    expect(names("winter")).toEqual(["Seasonal clothes"]);
  });

  it("shows everything with nothing typed", () => {
    expect(names("  ")).toHaveLength(4);
  });
});

describe("Storage on Home", () => {
  it("is always calm, saying how much is logged", () => {
    expect(storageTile(0)).toMatchObject({ status: "Nothing logged yet", actionItems: [] });
    expect(storageTile(1).status).toBe("1 entry");
    expect(storageTile(12).status).toBe("12 entries");
  });
});
