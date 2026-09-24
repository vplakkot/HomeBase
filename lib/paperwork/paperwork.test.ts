import { describe, expect, it } from "vitest";
import { paperworkTile, UNFILED_HREF } from "./action-items";
import {
  fileId,
  fileRows,
  keepUntil,
  labelText,
  ownerName,
  search,
  unfiled,
  type Category,
  type Paper,
  type PaperFile,
} from "./paperwork";

// Invented household paperwork; nothing here is real.
const TAXES: Category = { id: "c-tax", name: "Taxes", keep_years: 7 };
const CAR: Category = { id: "c-car", name: "Car", keep_years: null };
const file = (number: number, category: Category, label: string | null = null): PaperFile => ({
  id: `f-${number}`,
  number,
  category_id: category.id,
  location: "Hall cupboard, top shelf",
  label,
  status: "active",
});
const paper = (id: string, name: string, file_id: string | null, owner_id: string | null = null): Paper => ({
  id,
  name,
  owner_id,
  document_date: null,
  notes: null,
  keep_until: null,
  file_id,
  logged_on: "2026-09-24",
});

const FILES = [file(42, TAXES, "Returns 2020-2025"), file(7, CAR), file(1, TAXES)];
const PAPERS = [
  paper("p1", "2024 federal return", "f-42"),
  paper("p2", "2023 federal return", "f-42"),
  paper("p3", "Car title", "f-7"),
  paper("p4", "Water bill notice", null),
];
const ROWS = fileRows(FILES, [TAXES, CAR], PAPERS);

describe("a file's ID and label (REQ-88)", () => {
  it("pads the number to four digits after F-", () => {
    expect(fileId({ number: 1 })).toBe("F-0001");
    expect(fileId({ number: 42 })).toBe("F-0042");
    expect(fileId({ number: 12345 })).toBe("F-12345");
  });

  it("puts the ID and category together for the label printer", () => {
    expect(labelText({ number: 42 }, TAXES)).toBe("F-0042 · Taxes");
  });
});

describe("the files list (REQ-88)", () => {
  it("lists every file by number, with how many papers each holds", () => {
    expect(ROWS.map((row) => [fileId(row.file), row.category?.name, row.count])).toEqual([
      ["F-0001", "Taxes", 0],
      ["F-0007", "Car", 1],
      ["F-0042", "Taxes", 2],
    ]);
  });
});

describe("search (REQ-88)", () => {
  const ids = (query: string, category: string | null = null) =>
    search(ROWS, PAPERS, query, category).files.map((row) => fileId(row.file));

  it("finds a file by its ID however it's typed", () => {
    for (const typed of ["F-0042", "f-42", "F42", "42", "0042"]) expect(ids(typed), typed).toEqual(["F-0042"]);
  });

  it("finds files by label name and by category", () => {
    expect(ids("returns")).toEqual(["F-0042"]);
    expect(ids("taxes")).toEqual(["F-0001", "F-0042"]);
  });

  it("finds paperwork by name, filed or not", () => {
    expect(search(ROWS, PAPERS, "federal", null).papers.map((row) => row.id)).toEqual(["p1", "p2"]);
    expect(search(ROWS, PAPERS, "water", null).papers.map((row) => row.id)).toEqual(["p4"]);
  });

  it("filters by category, files and the paperwork in them", () => {
    expect(ids("", "c-car")).toEqual(["F-0007"]);
    expect(search(ROWS, PAPERS, "return", "c-car").papers).toEqual([]);
    expect(search(ROWS, PAPERS, "title", "c-car").papers.map((row) => row.id)).toEqual(["p3"]);
  });

  it("shows every file and no paperwork with nothing asked", () => {
    expect(search(ROWS, PAPERS, " ", null)).toEqual({ files: ROWS, papers: [] });
  });
});

describe("keep-until (REQ-97)", () => {
  it("is the document date plus the category's years", () => {
    expect(keepUntil("2024-04-15", "2026-09-24", 7)).toBe("2031-04-15");
  });

  it("uses the day it was logged when there's no document date", () => {
    expect(keepUntil(null, "2026-09-24", 7)).toBe("2033-09-24");
  });

  it("isn't filled in when the category has no default", () => {
    expect(keepUntil("2024-04-15", "2026-09-24", null)).toBeNull();
  });

  it("moves 29 February to the 28th in a year without one", () => {
    expect(keepUntil("2024-02-29", "2026-09-24", 1)).toBe("2025-02-28");
    expect(keepUntil("2024-02-29", "2026-09-24", 4)).toBe("2028-02-29");
  });
});

describe("paperwork", () => {
  it("is Unfiled when it has no file", () => {
    expect(unfiled(PAPERS).map((row) => row.id)).toEqual(["p4"]);
  });

  it("belongs to a member or is Joint", () => {
    const people = [{ user_id: "u-alex", name: "Alex" }];
    expect(ownerName(paper("x", "x", null, "u-alex"), people)).toBe("Alex");
    expect(ownerName(paper("x", "x", null, null), people)).toBe("Joint");
  });
});

describe("Paperwork on Home (REQ-97)", () => {
  it("has no action item and a quiet tile when everything is filed", () => {
    expect(paperworkTile(0)).toMatchObject({ status: "All filed", actionItems: [] });
  });

  it("says how many are unfiled, and opens the unfiled list", () => {
    const tile = paperworkTile(3);
    expect(tile.status).toBe("3 unfiled paperwork");
    expect(tile.actionItems).toEqual([
      expect.objectContaining({ text: "3 unfiled paperwork", href: UNFILED_HREF }),
    ]);
    expect(UNFILED_HREF).toBe("/paperwork/unfiled");
  });

  // Finances' items run 1 to 9; a paper on the desk comes after all of them.
  it("ranks below every Finances item", async () => {
    const { RANKS } = await import("../finances/action-items");
    expect(paperworkTile(1).actionItems[0].rank).toBeGreaterThan(Math.max(...Object.values(RANKS)));
  });
});
