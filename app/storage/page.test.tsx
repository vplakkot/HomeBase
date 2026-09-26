// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import EntryPage from "./entries/[id]/page";
import StoragePage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/storage",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

// An invented basement; nothing here is real.
const entry = (id: string, number: number, name: string, is_box: boolean, contents: string | null = null, note: string | null = null) => ({
  id,
  number,
  name,
  is_box,
  contents,
  note,
});
const ENTRIES = [
  entry("s1", 1, "Suitcases", false),
  entry("s3", 3, "Shoes", true, "Ski boots\nHiking boots\nSandals\nWellies"),
  entry("s4", 4, "Seasonal clothes", true, null, "winter clothes in summer"),
];
const TAXES = { id: "c-tax", name: "Taxes", keep_years: 7 };
const UNLABELLED = {
  id: "f-11",
  number: 11,
  category_id: "c-tax",
  location: "Hall cupboard",
  label: null,
  status: "archived",
  storage_entry_id: "s3",
};
const PAPER = { id: "p-1", name: "2019 return", owner_id: null, document_date: null, notes: null, keep_until: null, file_id: "f-9", logged_on: "2026-09-20" };
const ARCHIVED = {
  id: "f-9",
  number: 9,
  category_id: "c-tax",
  location: "Hall cupboard",
  label: "Old returns",
  status: "archived",
  storage_entry_id: "s3",
};

function given(permissions = ["use_modules"]) {
  const fake = fakeSupabase({
    permissions,
    tables: {
      storage_entries: ENTRIES,
      paperwork_categories: [TAXES],
      paperwork_files: [ARCHIVED, UNLABELLED],
      paperwork: [PAPER],
    },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const section = (name: RegExp) => screen.getByRole("region", { name });
const cards = (region: HTMLElement) => within(region).getAllByRole("link").map((link) => link.textContent);
const list = (q = "") => StoragePage({ searchParams: Promise.resolve({ q }) });
const open = (id: string, q = "") => EntryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ q }) });

describe("every Storage screen (REQ-107)", () => {
  it("has the search and Add to storage in the header", async () => {
    given();
    for (const page of [list(), open("s3")]) {
      render(await page);
      const header = screen.getByRole("banner");
      expect(within(header).getByRole("searchbox", { name: "Search storage" })).toBeDefined();
      expect(within(header).getByRole("button", { name: "Add to storage" })).toBeDefined();
      cleanup();
    }
  });

  it("shows search results in place of the screen, and Clear goes back to it", async () => {
    given();
    render(await open("s4", "ski boots"));
    expect(cards(section(/^Results/))).toEqual(["S-003 · Shoes2 archived paperwork filesSki boots, Hiking boots, Sandals, and 1 more"]);
    expect(screen.queryByRole("heading", { level: 2, name: /Seasonal clothes/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe("/storage/entries/s4");
  });

  it("finds entries by ID, and says when nothing matches", async () => {
    given();
    render(await list("s-4"));
    expect(cards(section(/^Results/))).toEqual(["S-004 · Seasonal clothesNote: winter clothes in summer"]);
    cleanup();
    render(await list("canoe"));
    expect(section(/^Results/).textContent).toContain("Nothing matches.");
  });

  it("adds in a sheet, then shows the new ID once and leaves you where you were", async () => {
    given();
    render(await open("s4"));
    fireEvent.click(screen.getByRole("button", { name: "Add to storage" }));
    const sheet = screen.getByRole("dialog", { name: "Add to storage" });
    expect(within(sheet).queryByLabelText(/Contents/)).toBeNull();
    fireEvent.click(within(sheet).getByLabelText("It's a box"));
    expect(within(sheet).getByLabelText("Contents (optional, one item per line)").tagName).toBe("TEXTAREA");
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Bags" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Add to storage" }));
    });
    const notice = await screen.findByRole("dialog", { name: "New entry: print its label" });
    // The stand-in database hands back its first entry row as the new one.
    expect(within(notice).getByLabelText(/^ID: S-/)).toBeDefined();
    fireEvent.click(within(notice).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { level: 2, name: /S-004 · Seasonal clothes/ })).toBeDefined();
  });
});

describe("Storage home (REQ-107)", () => {
  it("groups entries under Boxes and Not in a box, each with its count", async () => {
    given();
    render(await list());
    expect(section(/^Boxes/).querySelector("h2")?.textContent).toBe("Boxes · 2");
    expect(section(/^Not in a box/).querySelector("h2")?.textContent).toBe("Not in a box · 1");
    expect(cards(section(/^Boxes/))).toEqual([
      "S-003 · Shoes2 archived paperwork filesSki boots, Hiking boots, Sandals, and 1 more",
      "S-004 · Seasonal clothesNote: winter clothes in summer",
    ]);
    expect(cards(section(/^Not in a box/))).toEqual(["S-001 · Suitcases"]);
    expect(within(section(/^Boxes/)).getByRole("link", { name: /S-003/ }).getAttribute("href")).toBe("/storage/entries/s3");
  });

  it("has no breadcrumb at the top level", async () => {
    given();
    render(await list());
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });
});

describe("a Storage entry (REQ-107, REQ-98)", () => {
  it("has a breadcrumb back to Storage, and ID · name with Box as a superscript", async () => {
    given();
    render(await open("s3"));
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toBe("Storage› S-003");
    expect(within(crumbs).getByRole("link", { name: "Storage" }).getAttribute("href")).toBe("/storage");
    const title = screen.getByRole("heading", { level: 2, name: /S-003 · Shoes/ });
    expect(title.querySelector("sup")?.textContent).toBe("Box");
    cleanup();
    render(await open("s1"));
    expect(screen.getByRole("heading", { level: 2, name: "S-001 · Suitcases" }).querySelector("sup")).toBeNull();
  });

  it("lists a box's contents one per line, and says No note when it has none", async () => {
    given();
    render(await open("s3"));
    expect(screen.getByRole("list", { name: "Contents" }).textContent).toBe("Ski bootsHiking bootsSandalsWellies");
    expect(screen.getByRole("region", { name: "Contents and note" }).textContent).toContain("No note");
  });

  it("shows the note", async () => {
    given();
    render(await open("s4"));
    expect(screen.getByRole("region", { name: "Contents and note" }).textContent).toContain("winter clothes in summer");
  });

  it("has no contents for something that isn't a box", async () => {
    given();
    render(await open("s1"));
    expect(screen.queryByRole("list", { name: "Contents" })).toBeNull();
    expect(screen.getByRole("region", { name: "Note" }).textContent).toContain("No note");
  });

  it("lists archived paperwork files by ID, label name or No label, and documents, each opening in Paperwork", async () => {
    given();
    render(await open("s3"));
    const files = screen.getByRole("region", { name: "2 archived paperwork files" });
    expect(within(files).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "F-0009Old returns1 document",
      "F-0011No label0 documents",
    ]);
    expect(within(files).getAllByRole("link")[0].getAttribute("href")).toBe("/paperwork/files/f-9");
  });

  it("shows no forms until Manage is opened, and its menu has edit, label and remove", async () => {
    given();
    render(await open("s3"));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const menu = screen.getByRole("list", { name: "Manage" });
    expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Edit",
      "Show label to reprint",
      "Remove",
    ]);
  });

  it("edits every field in a sheet, ID not among them", async () => {
    given();
    render(await open("s3"));
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { name: "Edit S-003" });
    expect((within(sheet).getByLabelText("Name") as HTMLInputElement).value).toBe("Shoes");
    expect((within(sheet).getByLabelText("It's a box") as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByLabelText(/Contents/) as HTMLTextAreaElement).value).toContain("Wellies");
  });

  it("shows the label to reprint", async () => {
    given();
    render(await open("s3"));
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Show label to reprint" }));
    expect(within(screen.getByRole("dialog", { name: "Its label" })).getByLabelText("ID: S-003").textContent).toBe("S-003");
  });

  it("asks before removing, and Keep it closes the question", async () => {
    given();
    render(await open("s1"));
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const sheet = screen.getByRole("dialog", { name: "Remove S-001" });
    expect(sheet.textContent).toContain("Remove S-001 Suitcases?");
    expect(within(sheet).getByRole("button", { name: "Yes, remove it" })).toBeDefined();
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog", { name: "Remove S-001" })).toBeNull();
  });

  it("is not found for an entry that doesn't exist", async () => {
    given();
    await expect(open("nope")).rejects.toThrow("NOT_FOUND");
  });
});
