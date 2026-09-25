import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import {
  addCategory,
  archiveFile,
  bringBackFile,
  filePaper,
  logPaper,
  makeFile,
  removeCategory,
  removeFile,
  removePaper,
  updateFile,
  updatePaper,
} from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// Invented ids; nothing here is real.
const FILE = "11111111-1111-4111-8111-111111111111";
const NEW_FILE = "22222222-2222-4222-8222-222222222222";
const TAXES = "33333333-3333-4333-8333-333333333333";
const CAR = "44444444-4444-4444-8444-444444444444";
const ALEX = "55555555-5555-4555-8555-555555555555";
const P1 = "66666666-6666-4666-8666-666666666666";

let fake: ReturnType<typeof fakeSupabase>;

function given(permissions: string[] = ["use_modules"], tables: Record<string, unknown[]> = {}) {
  fake = fakeSupabase({
    permissions,
    tables: { paperwork_files: [{ id: NEW_FILE, number: 5 }], paperwork_categories: [{ name: "Taxes" }], ...tables },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

// The queries made on a table, in order.
const on = (table: string) =>
  fake.from.mock.calls
    .map(([name], index) => (name === table ? fake.from.mock.results[index].value : null))
    .filter(Boolean) as Record<string, ReturnType<typeof vi.fn>>[];

const PAPER = { name: "2024 federal return", ownerId: "joint", documentDate: "", notes: "", keepUntil: "" };

afterEach(() => vi.clearAllMocks());

describe("logPaper (REQ-97)", () => {
  it("logs paperwork with no file as Unfiled, Joint by default", async () => {
    given();
    expect(await logPaper({}, form({ ...PAPER, fileId: "" }))).toEqual({ saved: true });
    expect(on("paperwork")[0].insert).toHaveBeenCalledWith({
      name: "2024 federal return",
      owner_id: null,
      document_date: null,
      notes: null,
      keep_until: null,
      file_id: null,
    });
  });

  it("files it straight away into an existing file, with every field", async () => {
    given();
    const fields = { ...PAPER, ownerId: ALEX, documentDate: "2025-04-15", notes: "Filed online", keepUntil: "2032-04-15" };
    await logPaper({}, form({ ...fields, fileId: FILE }));
    expect(on("paperwork")[0].insert).toHaveBeenCalledWith({
      name: "2024 federal return",
      owner_id: ALEX,
      document_date: "2025-04-15",
      notes: "Filed online",
      keep_until: "2032-04-15",
      file_id: FILE,
    });
  });

  // REQ-100: you stay where you were; the form shows the label to print.
  it("makes a new file on the way, and says its label instead of opening it", async () => {
    given();
    const fields = { ...PAPER, fileId: "new", categoryId: TAXES, location: "Desk drawer", label: "" };
    expect(await logPaper({}, form(fields))).toEqual({ saved: true, newFile: "F-0005 · Taxes" });
    expect(on("paperwork_files")[0].insert).toHaveBeenCalledWith({ category_id: TAXES, location: "Desk drawer", label: null });
    expect(on("paperwork")[0].insert.mock.calls[0][0].file_id).toBe(NEW_FILE);
  });

  it("asks for a new file's category and location", async () => {
    given();
    expect(await logPaper({}, form({ ...PAPER, fileId: "new", categoryId: "", location: "x" }))).toEqual({
      error: "Choose the file's category.",
    });
    expect(await logPaper({}, form({ ...PAPER, fileId: "new", categoryId: TAXES, location: " " }))).toEqual({
      error: "Say where the file is kept.",
    });
    expect(on("paperwork_files")).toEqual([]);
  });

  it("needs a name, and saves nothing without one", async () => {
    given();
    expect(await logPaper({}, form({ ...PAPER, name: "  ", fileId: "" }))).toEqual({ error: "Give the document a name." });
    expect(on("paperwork")).toEqual([]);
  });

  it("is refused to someone who can't use modules", async () => {
    given([]);
    await expect(logPaper({}, form({ ...PAPER, fileId: "" }))).rejects.toThrow("REDIRECT:/paperwork");
  });
});

describe("updatePaper (REQ-97)", () => {
  // REQ-100: moving is its own form (filePaper), so editing leaves the
  // file alone.
  it("changes any field but its file", async () => {
    given();
    await updatePaper({}, form({ id: P1, ...PAPER, name: "2016 return", fileId: FILE }));
    const query = on("paperwork")[0];
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ name: "2016 return" }));
    expect(query.update.mock.calls[0][0]).not.toHaveProperty("file_id");
    expect(query.eq).toHaveBeenCalledWith("id", P1);
  });
});

describe("removePaper (REQ-97)", () => {
  it("removes it, so nothing logged by mistake is stuck", async () => {
    given();
    await expect(removePaper(form({ id: P1, fileId: FILE }))).rejects.toThrow(
      new RegExp(`^REDIRECT:/paperwork/files/${FILE}$`),
    );
    const query = on("paperwork")[0];
    expect(query.delete).toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("id", P1);
  });

  // REQ-100: you land back where the paper was.
  it("goes back to the unfiled list when it had no file", async () => {
    given();
    await expect(removePaper(form({ id: P1, fileId: "" }))).rejects.toThrow(/^REDIRECT:\/paperwork\/unfiled$/);
  });

  it("touches nothing without a proper id", async () => {
    given();
    await expect(removePaper(form({ id: "" }))).rejects.toThrow("REDIRECT:/paperwork");
    expect(on("paperwork")).toEqual([]);
  });
});

describe("filePaper (REQ-97)", () => {
  it("refuses a missing id rather than saying it saved", async () => {
    given();
    expect(await filePaper({}, form({ id: "", fileId: FILE, keepUntil: "" }))).toEqual({ error: "Nothing to change." });
    expect(on("paperwork")).toEqual([]);
  });

  it("files it with its keep-until, which takes it off the unfiled list", async () => {
    given();
    expect(await filePaper({}, form({ id: P1, fileId: FILE, keepUntil: "2033-09-24" }))).toEqual({ saved: true });
    expect(on("paperwork")[0].update).toHaveBeenCalledWith({ file_id: FILE, keep_until: "2033-09-24" });
  });

  it("needs a file: filing is the point", async () => {
    given();
    expect(await filePaper({}, form({ id: P1, fileId: "", keepUntil: "" }))).toEqual({
      error: "Choose a file, or make a new one.",
    });
  });

  it("can make a new file for it", async () => {
    given();
    const fields = { id: P1, fileId: "new", categoryId: CAR, location: "Glovebox", label: "Hatchback", keepUntil: "" };
    expect(await filePaper({}, form(fields))).toEqual({ saved: true, newFile: "F-0005 · Taxes" });
    expect(on("paperwork")[0].update).toHaveBeenCalledWith({ file_id: NEW_FILE, keep_until: null });
  });

  // REQ-100: "Move to another file" can also put it back on the desk.
  it("moves a filed paper to another file, or back to Unfiled", async () => {
    given();
    expect(await filePaper({}, form({ id: P1, fileId: FILE, keepUntil: "", moving: "yes" }))).toEqual({ saved: true });
    expect(on("paperwork")[0].update).toHaveBeenCalledWith({ file_id: FILE, keep_until: null });
    given();
    expect(await filePaper({}, form({ id: P1, fileId: "", keepUntil: "", moving: "yes" }))).toEqual({ saved: true });
    expect(on("paperwork")[0].update).toHaveBeenCalledWith({ file_id: null, keep_until: null });
  });
});

describe("files (REQ-88)", () => {
  it("makes a file and says its label to print", async () => {
    given();
    expect(await makeFile({}, form({ categoryId: TAXES, location: "Hall cupboard", label: "Returns" }))).toEqual({
      saved: true,
      newFile: "F-0005 · Taxes",
    });
    expect(on("paperwork_files")[0].insert).toHaveBeenCalledWith({
      category_id: TAXES,
      location: "Hall cupboard",
      label: "Returns",
    });
  });

  it("replaces the location when a file moves, never touching its number", async () => {
    given();
    await updateFile({}, form({ id: FILE, categoryId: TAXES, location: "Basement box", label: "" }));
    const update = on("paperwork_files")[0].update.mock.calls[0][0];
    expect(update).toEqual({ category_id: TAXES, location: "Basement box", label: null });
    expect(update).not.toHaveProperty("number");
  });

  it("removes a file", async () => {
    given();
    await expect(removeFile(form({ id: FILE }))).rejects.toThrow("REDIRECT:/paperwork");
    expect(on("paperwork_files")[0].delete).toHaveBeenCalled();
  });
});

describe("categories (REQ-88)", () => {
  it("are the admin's to add, with an optional keep-until in years", async () => {
    given(["use_modules", "manage_paperwork"]);
    expect(await addCategory({}, form({ name: "Taxes", keepYears: "7" }))).toEqual({ saved: true });
    expect(await addCategory({}, form({ name: "Car", keepYears: "" }))).toEqual({ saved: true });
    expect(on("paperwork_categories").map((query) => query.insert.mock.calls[0][0])).toEqual([
      { name: "Taxes", keep_years: 7 },
      { name: "Car", keep_years: null },
    ]);
  });

  it("are refused to a member", async () => {
    given(["use_modules"]);
    await expect(addCategory({}, form({ name: "Taxes", keepYears: "" }))).rejects.toThrow("REDIRECT:/paperwork");
  });

  it("refuse a keep-until that isn't a whole number of years", async () => {
    given(["use_modules", "manage_paperwork"]);
    expect(await addCategory({}, form({ name: "Taxes", keepYears: "7.5" }))).toEqual({
      error: "Keep for a whole number of years, or leave it blank.",
    });
  });

  it("in use can't be removed until its files are moved", async () => {
    given(["use_modules", "manage_paperwork"], { paperwork_files: [{ id: FILE }, { id: NEW_FILE }] });
    expect(await removeCategory({}, form({ id: TAXES }))).toEqual({
      error: "2 files use it. Choose a category to move them to first.",
    });
    expect(on("paperwork_categories")).toEqual([]);
  });

  it("in use moves its files to the chosen category, then goes", async () => {
    given(["use_modules", "manage_paperwork"], { paperwork_files: [{ id: FILE }] });
    expect(await removeCategory({}, form({ id: TAXES, moveTo: CAR }))).toEqual({ saved: true });
    const [, move] = on("paperwork_files");
    expect(move.update).toHaveBeenCalledWith({ category_id: CAR });
    expect(move.eq).toHaveBeenCalledWith("category_id", TAXES);
    expect(on("paperwork_categories")[0].delete).toHaveBeenCalled();
  });

  it("not in use is simply removed", async () => {
    given(["use_modules", "manage_paperwork"], { paperwork_files: [] });
    expect(await removeCategory({}, form({ id: CAR }))).toEqual({ saved: true });
    expect(on("paperwork_categories")[0].delete).toHaveBeenCalled();
  });
});

describe("archiving a file to storage (REQ-98)", () => {
  const BOX = "77777777-7777-4777-8777-777777777777";

  it("archives the whole file into the chosen box", async () => {
    given();
    expect(await archiveFile({}, form({ id: FILE, boxId: BOX }))).toEqual({ saved: true });
    const [update] = on("paperwork_files");
    expect(update.update).toHaveBeenCalledWith({ status: "archived", storage_entry_id: BOX });
    expect(update.eq).toHaveBeenCalledWith("id", FILE);
  });

  it("needs a box", async () => {
    given();
    expect(await archiveFile({}, form({ id: FILE, boxId: "" }))).toEqual({ error: "Choose the box it goes in." });
    expect(fake.from).not.toHaveBeenCalledWith("paperwork_files");
  });

  it("brings it back to a new office location, Active again", async () => {
    given();
    expect(await bringBackFile({}, form({ id: FILE, location: " Study drawer " }))).toEqual({ saved: true });
    expect(on("paperwork_files")[0].update).toHaveBeenCalledWith({
      status: "active",
      storage_entry_id: null,
      location: "Study drawer",
    });
  });

  it("needs the new location to bring it back", async () => {
    given();
    expect(await bringBackFile({}, form({ id: FILE, location: "" }))).toEqual({
      error: "Say where the file is kept now.",
    });
  });
});
