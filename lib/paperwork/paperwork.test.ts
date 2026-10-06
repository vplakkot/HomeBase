import { describe, expect, it, type vi } from "vitest";
import { fakeSupabase } from "../../test/fake-supabase";
import { paperworkTile, unfiledItem, UNFILED_HREF } from "./action-items";
import {
  categoryCards,
  countUnfiled,
  documentsByYear,
  archiveName,
  cardFiles,
  DRIVE_ARCHIVE_HREF,
  driveArchiveDocuments,
  driveFileState,
  driveUnfiled,
  expectedFolderName,
  placeOf,
  places,
  sameLocation,
  sortedLocations,
  tidyName,
  fileId,
  fileRows,
  keepUntil,
  labelText,
  ownerName,
  search,
  unfiled,
  unlinkedFolders,
  type Archive,
  type Category,
  type Location,
  type Paper,
  type PaperFile,
} from "./paperwork";
import type { DriveDocument, DriveFolder } from "./drive-sync";

// Invented household paperwork; nothing here is real.
const TAXES: Category = { id: "c-tax", name: "Taxes", keep_years: 7 };
const CAR: Category = { id: "c-car", name: "Car", keep_years: null };
const file = (number: number, category: Category, label: string | null = null): PaperFile => ({
  id: `f-${number}`,
  number,
  category_id: category.id,
  location_id: "l-hall",
  label,
  status: "active",
  storage_entry_id: null,
  is_drive: false,
  drive_folder_id: null,
});
const paper = (id: string, name: string, file_id: string | null, owner_id: string | null = null): Paper => ({
  id,
  name,
  owner_id,
  document_date: null,
  notes: null,
  keep_until: null,
  file_id,
  archive_id: null,
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

  it("is not Unfiled once archived on its own (REQ-153)", () => {
    expect(unfiled([...PAPERS, { ...paper("p5", "Old lease", null), archive_id: "a-1" }]).map((row) => row.id)).toEqual(["p4"]);
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
    expect(tile.status).toBe("3 documents unfiled");
    expect(tile.actionItems).toEqual([
      expect.objectContaining({ text: "3 documents unfiled", href: UNFILED_HREF }),
    ]);
    expect(UNFILED_HREF).toBe("/paperwork/unfiled");
  });

  // Finances' items run 1 to 9; a paper on the desk comes after all of them.
  it("ranks below every Finances item", async () => {
    const { RANKS } = await import("../finances/action-items");
    expect(paperworkTile(1).actionItems[0].rank).toBeGreaterThan(Math.max(...Object.values(RANKS)));
  });
});

describe("countUnfiled (REQ-97)", () => {
  it("counts only paperwork with no file", async () => {
    const fake = fakeSupabase({ tables: { paperwork: [{ id: "a" }, { id: "b" }] } });
    expect(await countUnfiled(fake as never)).toBe(2);
    const query = fake.from.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(query.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(query.is).toHaveBeenCalledWith("file_id", null);
    expect(query.is).toHaveBeenCalledWith("archive_id", null);
  });
});

describe("locations (REQ-179)", () => {
  const HALL: Location = { id: "l-hall", name: "Hall cupboard", built_in: null };
  const OFFICE: Location = { id: "l-office", name: "Office · Cabinet", built_in: null };
  const SHED: Location = { id: "l-shed", name: "Shed", built_in: null };

  it("are the same place however the case or spacing differs, but not the dots", () => {
    expect(sameLocation("Office · Cabinet", "office  ·  cabinet")).toBe(true);
    expect(sameLocation(" Hall cupboard ", "hall   CUPBOARD")).toBe(true);
    expect(sameLocation("Hall cupboard", "hall cupboard.")).toBe(false);
    expect(sameLocation("Office · Cabinet", "Office · Desk")).toBe(false);
  });

  it("are saved with their spaces tidied", () => {
    expect(tidyName("  Hall   cupboard ")).toBe("Hall cupboard");
  });

  it("are listed by name for the pickers", () => {
    expect(sortedLocations([SHED, HALL, OFFICE]).map((row) => row.name)).toEqual(["Hall cupboard", "Office · Cabinet", "Shed"]);
  });

  it("each get a card, an empty one too, with its files and documents", () => {
    const { office } = places(FILES, [TAXES, CAR], PAPERS, [], [HALL, SHED]);
    expect(office.map((card) => [card.name, card.href, card.files.length, card.items])).toEqual([
      ["Hall cupboard", "/paperwork/locations/l-hall", 3, 3],
      ["Shed", "/paperwork/locations/l-shed", 0, 0],
    ]);
  });

  it("name where a file is by its location record", () => {
    expect(placeOf(FILES[0], [], [OFFICE, HALL])).toEqual({ name: "Hall cupboard", href: "/paperwork/locations/l-hall" });
  });
});

describe("archives (REQ-153)", () => {
  const BOX = { id: "s-1", number: 3, name: "Basement box", is_box: true, contents: null, note: null };
  const ARCHIVE: Archive = { id: "a-1", storage_entry_id: "s-1" };
  const archived = (id: string, name: string) => ({ ...paper(id, name, null), archive_id: "a-1" });

  it("are named for their box, never given an F-ID", () => {
    expect(archiveName(BOX)).toBe("Archive · S-003");
  });

  it("show on their box's card beside its archived files, counted as a file", () => {
    const stored = { ...file(9, CAR), status: "archived" as const, storage_entry_id: "s-1" };
    const { archived: cards } = places([stored], [CAR], [archived("p1", "Old lease"), archived("p2", "Old policy")], [BOX], [], [ARCHIVE]);
    expect(cards).toHaveLength(1);
    expect(cards[0].href).toBe("/paperwork/boxes/s-1");
    expect(cards[0].archive?.count).toBe(2);
    expect(cardFiles(cards[0])).toBe(2);
    expect(cards[0].items).toBe(2);
  });

  it("make a card for a box that holds only an archive", () => {
    const { archived: cards } = places([], [], [archived("p1", "Old lease")], [BOX], [], [ARCHIVE]);
    expect(cards.map((card) => [card.name, cardFiles(card), card.items])).toEqual([["Box S-003 · Basement box", 1, 1]]);
  });
});

describe("Paperwork's own action item (REQ-100)", () => {
  it("counts documents on the desk and names the day the oldest was logged", () => {
    const desk = [
      { ...paper("a", "Water bill notice", null), logged_on: "2026-09-20" },
      { ...paper("b", "Parking permit", null), logged_on: "2026-09-12" },
      paper("c", "2024 federal return", "f-42"),
      { ...paper("d", "Old lease", null), archive_id: "a-1" },
    ];
    expect(unfiledItem(desk)).toEqual({ text: "2 documents unfiled on your desk", detail: "Oldest logged 12 Sep" });
    expect(unfiledItem([{ ...paper("a", "One", null) }])?.text).toBe("1 document unfiled on your desk");
  });

  it("is absent when everything is filed", () => {
    expect(unfiledItem([paper("c", "2024 federal return", "f-42")])).toBeNull();
  });
});

describe("browsing by category (REQ-105)", () => {
  const dated = (id: string, name: string, date: string | null, fileId = "f-42") => ({
    ...paper(id, name, fileId),
    document_date: date,
  });

  it("counts each category's files and the documents in them, leaving unfiled ones out", () => {
    expect(categoryCards([TAXES, CAR], FILES, PAPERS)).toEqual([
      { category: TAXES, files: 2, documents: 2 },
      { category: CAR, files: 1, documents: 1 },
    ]);
  });

  it("lists documents by year, newest first, with an empty row for a year with nothing, and undated last", () => {
    const rows = documentsByYear([
      dated("a", "2018 return", "2018-04-10"),
      dated("b", "W-2", "2024-01-31", "f-1"),
      dated("c", "Federal return", "2024-04-15"),
      dated("d", "2020 return", "2020-04-15"),
      dated("e", "Old receipt", null),
    ]);
    expect(rows.map((row) => [row.year, row.papers.map((one) => one.name)])).toEqual([
      [2024, ["Federal return", "W-2"]],
      [2023, []],
      [2022, []],
      [2021, []],
      [2020, ["2020 return"]],
      [2019, []],
      [2018, ["2018 return"]],
      [null, ["Old receipt"]],
    ]);
  });

  it("shows no gaps before the oldest or after the newest year, and nothing when empty", () => {
    expect(documentsByYear([dated("a", "Return", "2022-04-15")]).map((row) => row.year)).toEqual([2022]);
    expect(documentsByYear([dated("a", "Receipt", null)]).map((row) => row.year)).toEqual([null]);
    expect(documentsByYear([])).toEqual([]);
  });
});

describe("Google Drive files (REQ-152, REQ-153)", () => {
  const DRIVE_LOC: Location = { id: "l-drive", name: "Google Drive", built_in: "drive" };
  const driveFile = (number: number, folder: string | null, over: Partial<PaperFile> = {}): PaperFile => ({
    ...file(number, TAXES, "Returns"),
    location_id: "l-drive",
    is_drive: true,
    drive_folder_id: folder,
    ...over,
  });
  const document = (drive_id: string, parent_id: string, missing = false): DriveDocument => ({
    drive_id, name: drive_id, mime_type: null, link: null, drive_owner_email: null, parent_id, owner_id: null, owner_set: false, missing,
  });
  const folder = (drive_id: string, name: string, over: Partial<DriveFolder> = {}): DriveFolder => ({
    drive_id, name, in_archived: false, ignored: false, missing: false, ...over,
  });
  const CONNECTION = { folder_id: "top", archived_folder_id: "arch", synced_at: null };

  it("names the folder <ID>_<Category>_<label>, or without a label", () => {
    expect(expectedFolderName({ number: 42, label: "2025 Returns" }, TAXES)).toBe("F-0042_Taxes_2025 Returns");
    expect(expectedFolderName({ number: 42, label: null }, TAXES)).toBe("F-0042_Taxes");
  });

  it("counts a Drive file's documents from its folder, not the papers table", () => {
    const rows = fileRows([driveFile(5, "fold-1")], [TAXES], [], {
      documents: [document("a", "fold-1"), document("b", "fold-1"), document("gone", "fold-1", true), document("c", "other")],
    });
    expect(rows[0].count).toBe(2);
  });

  it("is waiting before its folder is linked", () => {
    expect(driveFileState(driveFile(5, null), { folders: [], documents: [] })).toEqual({ kind: "waiting" });
  });

  it("is missing when its folder is gone from Drive or was never seen", () => {
    expect(driveFileState(driveFile(5, "f"), { folders: [folder("f", "x", { missing: true })], documents: [] })).toEqual({ kind: "missing" });
    expect(driveFileState(driveFile(5, "f"), { folders: [], documents: [] })).toEqual({ kind: "missing" });
  });

  it("is linked with the documents directly in its folder", () => {
    const state = driveFileState(driveFile(5, "f"), { folders: [folder("f", "F-0005_Taxes")], documents: [document("a", "f"), document("b", "other")] });
    expect(state).toMatchObject({ kind: "linked", documents: [{ drive_id: "a" }] });
  });

  it("lists unlinked folders: not linked, not ignored, not gone", () => {
    const folders = [folder("f1", "F-0005_Taxes"), folder("f2", "Stray"), folder("f3", "Ignored", { ignored: true }), folder("f4", "Gone", { missing: true })];
    expect(unlinkedFolders({ folders }, [driveFile(5, "f1")]).map((row) => row.drive_id)).toEqual(["f2"]);
  });

  it("shows loose top-level documents as Unfiled · Google Drive, apart from Archived ones", () => {
    const documents = [document("loose", "top"), document("filed", "fold-1"), document("old", "arch"), document("old-gone", "arch", true)];
    expect(driveUnfiled({ connection: CONNECTION, documents }).map((row) => row.drive_id)).toEqual(["loose"]);
    expect(driveArchiveDocuments({ connection: CONNECTION, documents }).map((row) => row.drive_id)).toEqual(["old"]);
    expect(driveUnfiled({ connection: null, documents })).toEqual([]);
  });

  it("puts an archived Drive file in Google Drive · Archived, not a storage box", () => {
    const archived = driveFile(5, "f", { status: "archived" });
    expect(placeOf(archived, [], [DRIVE_LOC])).toEqual({ name: "Google Drive · Archived", href: DRIVE_ARCHIVE_HREF });
    expect(placeOf(driveFile(6, "g"), [], [DRIVE_LOC])).toEqual({ name: "Google Drive", href: "/paperwork/locations/l-drive" });
  });

  it("gives the Archived folder its own card with archived files and loose documents", () => {
    const drive = { connection: CONNECTION, folders: [], documents: [document("old", "arch"), document("x", "f")] };
    const { office, archived } = places(
      [driveFile(5, "f", { status: "archived" }), driveFile(6, "g")],
      [TAXES], [], [], [DRIVE_LOC], [], drive,
    );
    expect(office.map((card) => [card.name, card.files.length])).toEqual([["Google Drive", 1]]);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ name: "Google Drive · Archived", items: 2 });
    expect(cardFiles(archived[0])).toBe(2);
  });
});
