// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import BoxPage from "./boxes/[id]/page";
import CategoryPage from "./categories/[id]/page";
import CategoriesPage from "./categories/page";
import FilePage from "./files/[id]/page";
import { PaperForm } from "./forms";
import PaperPage from "./items/[id]/page";
import ArchivePage from "./archives/[id]/page";
import LocationPage from "./locations/[id]/page";
import PaperworkPage from "./page";
import PaperworkSettingsPage from "./settings/page";
import UnfiledPage from "./unfiled/page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/paperwork",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

// An invented household and its paperwork; nothing here is real.
const PEOPLE = [
  { user_id: "u-alex", name: "Alex", manages_budget: true },
  { user_id: "u-sam", name: "Sam", manages_budget: false },
];
const TAXES = { id: "c-tax", name: "Taxes", keep_years: 7 };
// A real-looking id, since making a file checks the category's id.
const CAR = { id: "c0ca0000-0000-4000-8000-000000000001", name: "Car", keep_years: null };
// Locations are records (REQ-179); the shed has no files.
const HALL = { id: "10ca0000-0000-4000-8000-000000000001", name: "Hall cupboard", built_in: null };
const GLOVEBOX = { id: "10ca0000-0000-4000-8000-000000000002", name: "Glovebox" };
const SHED = { id: "10ca0000-0000-4000-8000-000000000003", name: "Shed" };
const file = (id: string, number: number, category_id: string, label: string | null, location_id: string) => ({
  id,
  number,
  category_id,
  location_id,
  label,
  status: "active",
  storage_entry_id: null,
});
const FILES = [
  file("f-42", 42, "c-tax", "Returns", HALL.id),
  file("f-7", 7, CAR.id, null, GLOVEBOX.id),
  file("f-43", 43, CAR.id, null, HALL.id),
];
const ARCHIVED = {
  ...file("f-9", 9, "c-tax", "Old returns", HALL.id),
  status: "archived",
  storage_entry_id: "s3",
};
const paper = (id: string, name: string, file_id: string | null, owner_id: string | null = null) => ({
  id,
  name,
  owner_id,
  document_date: null as string | null,
  notes: null,
  keep_until: null,
  file_id,
  archive_id: null as string | null,
  logged_on: "2026-09-20",
});
const PAPERS = [
  paper("p1", "2024 federal return", "f-42", "u-alex"),
  paper("p2", "2023 federal return", "f-42"),
  paper("p3", "Water bill notice", null, "u-sam"),
  paper("p4", "2012 federal return", "f-9"),
];
// Storage's entries, for archiving (REQ-98): one box and one loose item.
const SHOES_BOX = { id: "s3", number: 3, name: "Shoes", is_box: true, contents: null, note: null };
const SUITCASES = { id: "s1", number: 1, name: "Suitcases", is_box: false, contents: null, note: null };

// The Shoes box's archive (REQ-153) holds one document.
const SHOES_ARCHIVE = { id: "a3", storage_entry_id: "s3" };

function given(
  permissions = ["use_modules"],
  { files = [...FILES, ARCHIVED], papers = PAPERS, archives = [] as unknown[] } = {},
) {
  const fake = fakeSupabase({
    permissions,
    people: PEOPLE,
    tables: {
      paperwork_categories: [CAR, TAXES],
      paperwork_files: files,
      paperwork: papers,
      paperwork_locations: [GLOVEBOX, HALL, SHED],
      paperwork_archives: archives,
      storage_entries: [SUITCASES, SHOES_BOX],
    },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  return fake;
}

const ADMIN = ["use_modules", "manage_members", "manage_paperwork"];
const card = (name: string) => screen.getByRole("region", { name });
const q = (query = "") => Promise.resolve(query ? { q: query } : {});
const home = (query?: string) => PaperworkPage({ searchParams: q(query) });
const place = (id: string, query?: string) => LocationPage({ params: Promise.resolve({ id }), searchParams: q(query) });
const openFile = (id: string) => FilePage({ params: Promise.resolve({ id }), searchParams: q() });
const crumbs = () =>
  within(screen.getByRole("navigation", { name: "Breadcrumb" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent?.replace("› ", ""));
const links = (region: HTMLElement) =>
  within(region)
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);

describe("the module's structure (REQ-100)", () => {
  // DESIGN.md §11: Categories is a browse view for everyone now; managing
  // them moved behind the settings gear.
  it("has the tabs Overview, Unfiled and Categories, none admin-only", async () => {
    given(ADMIN);
    render(await home());
    const tabs = screen.getByRole("navigation", { name: "Paperwork sections" });
    expect(links(tabs)).toEqual([
      ["Overview", "/paperwork"],
      ["Unfiled", "/paperwork/unfiled"],
      ["Categories", "/paperwork/categories"],
    ]);
  });

  it("puts search, the settings gear, New file and Log document in the header of every screen", async () => {
    given(ADMIN);
    for (const page of [
      home(),
      place("10ca0000-0000-4000-8000-000000000001"),
      openFile("f-42"),
      UnfiledPage({ searchParams: q() }),
      CategoriesPage({}),
    ]) {
      render(await page);
      const header = screen.getByRole("banner");
      expect(within(header).getByRole("searchbox", { name: "Search files and documents" })).toBeDefined();
      expect(within(header).getByRole("link", { name: "Paperwork settings" }).getAttribute("href")).toBe(
        "/paperwork/settings",
      );
      expect(within(header).getByRole("button", { name: "Log document" })).toBeDefined();
      // #254: a file can be made on its own, not only from Log document.
      expect(within(header).getByRole("button", { name: "New file" })).toBeDefined();
      cleanup();
    }
  });

  it("opens the New file form from the header (#254)", async () => {
    given();
    render(await home());
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "New file" }));
    expect(screen.getByRole("dialog", { name: "New file" })).toBeDefined();
  });

  it("shows members no settings gear", async () => {
    given();
    render(await home());
    expect(screen.queryByRole("link", { name: "Paperwork settings" })).toBeNull();
  });

  it("calls each paperwork item a document", async () => {
    given();
    render(await home());
    expect(screen.getByRole("main").textContent).not.toMatch(/\d items?\b|unfiled paperwork/);
  });

  it("shows where you are below the top level, each step linking back up", async () => {
    given();
    render(await home());
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    cleanup();
    render(await openFile("f-42"));
    expect(crumbs()).toEqual(["Paperwork", "Hall cupboard", "F-0042"]);
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(links(trail)).toEqual([
      ["Paperwork", "/paperwork"],
      ["Hall cupboard", "/paperwork/locations/10ca0000-0000-4000-8000-000000000001"],
    ]);
    expect(within(trail).getByText("F-0042").getAttribute("aria-current")).toBe("page");
  });
});

describe("screen 1: overview (REQ-100, DESIGN.md §11)", () => {
  it("runs Action items, the summary, Locations, then Archived in storage", async () => {
    given();
    render(await home());
    const order = Array.from(screen.getByRole("main").querySelectorAll("section")).map(
      (section) => section.getAttribute("aria-label") ?? section.querySelector("h2")?.textContent,
    );
    expect(order).toEqual(["Action items 1", "Summary", "Locations", "Archived in storage"]);
  });

  it("sums up locations, files and documents", async () => {
    given();
    render(await home());
    expect(card("Summary").textContent).toBe("Locations4Files4Documents4");
  });

  it("has a card per location with its file and document counts, an empty one too (REQ-179)", async () => {
    given();
    render(await home());
    expect(links(card("Locations"))).toEqual([
      ["Glovebox1 file · 0 documents", "/paperwork/locations/10ca0000-0000-4000-8000-000000000002"],
      ["Hall cupboard2 files · 2 documents", "/paperwork/locations/10ca0000-0000-4000-8000-000000000001"],
      ["Shed0 files · 0 documents", "/paperwork/locations/10ca0000-0000-4000-8000-000000000003"],
    ]);
  });

  it("offers Add location on the home, with a name and nothing else (REQ-179)", async () => {
    given();
    render(await home());
    fireEvent.click(within(card("Locations")).getByRole("button", { name: "Add location" }));
    const sheet = screen.getByRole("dialog", { name: "Add location" });
    expect(within(sheet).getByLabelText("Name")).toBeDefined();
    expect(within(sheet).getByRole("button", { name: "Add the location" })).toBeDefined();
  });

  it("puts each box holding archived files under Archived in storage, below", async () => {
    given();
    render(await home());
    expect(links(card("Archived in storage"))).toEqual([
      ["Box S-003 · Shoes1 file · 1 document", "/paperwork/boxes/s3"],
    ]);
  });

  it("has no Archived in storage heading when nothing is archived", async () => {
    given(["use_modules"], { files: FILES });
    render(await home());
    expect(screen.queryByRole("region", { name: "Archived in storage" })).toBeNull();
  });

  it("has one action item while documents are unfiled, with File it opening the unfiled list", async () => {
    given();
    render(await home());
    const items = card("Action items 1");
    expect(within(items).getByRole("listitem").textContent).toBe(
      "1 document unfiled on your deskOldest logged 20 SepFile it",
    );
    expect(within(items).getByRole("link", { name: "File it" }).getAttribute("href")).toBe("/paperwork/unfiled");
    cleanup();
    given(["use_modules"], { papers: PAPERS.filter((row) => row.file_id) });
    render(await home());
    expect(screen.queryByRole("region", { name: /Action items/ })).toBeNull();
  });
});

describe("screen 2: files in a place (REQ-100)", () => {
  it("shows every file there as ID · category, label name or No label, and document count", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000001"));
    expect(screen.getByRole("heading", { level: 2, name: "Hall cupboard" })).toBeDefined();
    expect(links(screen.getByRole("main")).filter(([, href]) => href?.startsWith("/paperwork/files/"))).toEqual([
      ["F-0042 · TaxesReturns2 documents", "/paperwork/files/f-42"],
      ["F-0043 · CarNo label0 documents", "/paperwork/files/f-43"],
    ]);
  });

  it("has Manage location with Rename, and Delete only when it has no files (REQ-179)", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000001"));
    fireEvent.click(screen.getByRole("button", { name: "Manage location" }));
    const menu = screen.getByRole("list", { name: "Manage location" });
    expect(within(menu).getByRole("button", { name: "Rename" })).toBeDefined();
    expect(within(menu).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(menu.textContent).toContain("It must be empty before it can be deleted.");
  });

  it("counts a file archived in storage as still in its location, so Delete stays unavailable (REQ-179)", async () => {
    // Only the archived file is left in the hall cupboard.
    given(["use_modules"], { files: [ARCHIVED] });
    render(await place("10ca0000-0000-4000-8000-000000000001"));
    fireEvent.click(screen.getByRole("button", { name: "Manage location" }));
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("offers Delete, after asking, for an empty location (REQ-179)", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000003"));
    expect(screen.getByRole("heading", { level: 2, name: "Shed" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Manage location" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Yes, remove the location" })).toBeDefined();
  });

  it("renames from its menu, starting from the current name (REQ-179)", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000001"));
    fireEvent.click(screen.getByRole("button", { name: "Manage location" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const sheet = screen.getByRole("dialog", { name: "Rename the location" });
    expect((within(sheet).getByLabelText("Name") as HTMLInputElement).value).toBe("Hall cupboard");
  });

  it("does the same for a storage box, with the box in the breadcrumb", async () => {
    given();
    render(await BoxPage({ params: Promise.resolve({ id: "s3" }), searchParams: q() }));
    expect(crumbs()).toEqual(["Paperwork", "Box S-003 · Shoes"]);
    expect(screen.getByRole("link", { name: /F-0009 · Taxes/ }).textContent).toBe(
      "F-0009 · TaxesOld returns1 document",
    );
  });

  it("is not found for a place with no files", async () => {
    given();
    await expect(place("Garage")).rejects.toThrow("NOT_FOUND");
  });
});

describe("screen 3: a file (REQ-100)", () => {
  it("heads with ID · category, label name, location and plain-text status, then lists every document", async () => {
    given();
    render(await openFile("f-42"));
    expect(screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" })).toBeDefined();
    const facts = screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" }).nextElementSibling?.textContent;
    expect(facts).toBe("Returns·Hall cupboard·Active");
    const rows = within(screen.getByRole("list", { name: "Documents in this file" })).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual([
      "2024 federal returnAlexNo dateKeep",
      "2023 federal returnJointNo dateKeep",
    ]);
  });

  it("shows an archived file as Archived, in its box", async () => {
    given();
    render(await openFile("f-9"));
    expect(screen.getByRole("heading", { level: 2, name: "F-0009 · Taxes" }).nextElementSibling?.textContent).toBe(
      "Old returns·Box S-003 · Shoes·Archived",
    );
  });

  it("shows no edit forms until Manage file is opened, then one menu of four", async () => {
    given();
    render(await openFile("f-42"));
    expect(screen.queryByLabelText("Location")).toBeNull();
    const manage = screen.getByRole("button", { name: "Manage file" });
    expect(manage.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(manage);
    const menu = screen.getByRole("list", { name: "Manage file" });
    expect(
      within(menu)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Edit category, label or location", "Show label to reprint", "Archive to a storage box", "Remove file"]);
  });

  it("edits the file, shows its label, archives it (boxes only) or removes it, each in a sheet", async () => {
    given();
    render(await openFile("f-42"));
    const pick = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Manage file" }));
      fireEvent.click(screen.getByRole("button", { name }));
    };
    pick("Edit category, label or location");
    // A pick from the locations, never free text (REQ-179).
    const picker = screen.getByLabelText("Location") as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    expect(picker.value).toBe("10ca0000-0000-4000-8000-000000000001");
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Choose a location",
      "Glovebox",
      "Hall cupboard",
      "Shed",
      "New location…",
    ]);
    pick("Show label to reprint");
    expect(screen.getByLabelText("Label: F-0042 · Taxes")).toBeDefined();
    pick("Archive to a storage box");
    const box = screen.getByLabelText("Box");
    expect(
      within(box)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Choose a box", "S-003 · Shoes"]);
    pick("Remove file");
    expect(screen.getByRole("button", { name: "Yes, remove the file" })).toBeDefined();
    // Removing leaves you in the file's location.
    const back = document.querySelector("input[name=returnTo]") as HTMLInputElement;
    expect(back.value).toBe("/paperwork/locations/10ca0000-0000-4000-8000-000000000001");
  });

  it("offers Bring back from storage for an archived file", async () => {
    given();
    render(await openFile("f-9"));
    fireEvent.click(screen.getByRole("button", { name: "Manage file" }));
    fireEvent.click(screen.getByRole("button", { name: "Bring back from storage" }));
    expect(screen.getByLabelText("New location")).toBeDefined();
  });

  it("lets a file's location be a new one made on the spot, named beside the list (REQ-179)", async () => {
    given();
    render(await openFile("f-42"));
    fireEvent.click(screen.getByRole("button", { name: "Manage file" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit category, label or location" }));
    expect(screen.queryByLabelText("New location name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "new" } });
    expect(screen.getByLabelText("New location name")).toBeDefined();
  });

  it("adds a document straight into the file: the form has no file to choose", async () => {
    given();
    render(await openFile("f-42"));
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    const sheet = screen.getByRole("dialog", { name: "Add document" });
    expect(within(sheet).queryByLabelText("File")).toBeNull();
    const hidden = sheet.querySelector("input[name=fileId]") as HTMLInputElement;
    expect(hidden.value).toBe("f-42");
  });

  it("opens a paper's details to edit any field, and Move to another file from there", async () => {
    given();
    render(await PaperPage({ params: Promise.resolve({ id: "p1" }) }));
    expect(crumbs()).toEqual(["Paperwork", "Hall cupboard", "F-0042", "2024 federal return"]);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("2024 federal return");
    expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("u-alex");
    expect(screen.queryByLabelText("File")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move to another file" }));
    const move = within(screen.getByRole("dialog", { name: "Move to another file" })).getByLabelText("Move to");
    const options = within(move)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toContain("Unfiled");
    expect(options).toContain("F-0007 · Car");
    expect(options.some((option) => option?.startsWith("F-0042"))).toBe(false);
  });
});

describe("screen 4: search (REQ-100)", () => {
  it("replaces the screen with results in Files and Documents", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000001", "return"));
    expect(screen.queryByRole("heading", { level: 2, name: "Hall cupboard" })).toBeNull();
    expect(crumbs()).toEqual(["Paperwork", "Results for “return”"]);
    expect(card("Files").textContent).toContain("2 files");
    expect(card("Documents").textContent).toContain("3 documents");
  });

  it("matches file ID, label name and category", async () => {
    given();
    for (const [query, want] of [
      ["F-0042", "F-0042 · Taxes"],
      ["returns", "F-0042 · Taxes"],
      ["car", "F-0043 · Car"],
    ]) {
      render(await home(query));
      expect(screen.getByRole("region", { name: /^Files/ }).textContent, query).toContain(want);
      cleanup();
    }
  });

  it("shows each document's file ID and where it is, Unfiled / Your desk when it has none", async () => {
    given();
    render(await home("e"));
    const rows = within(card("Documents")).getAllByRole("link");
    const text = (name: string) => rows.find((row) => row.textContent?.startsWith(name))?.textContent;
    expect(text("2024 federal return")).toBe("2024 federal returnF-0042Hall cupboard");
    expect(text("2012 federal return")).toBe("2012 federal returnF-0009Box S-003 · Shoes");
    expect(text("Water bill notice")).toBe("Water bill noticeUnfiledYour desk");
  });

  it("clears back to the screen it was typed on", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000001", "return"));
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe(
      "/paperwork/locations/10ca0000-0000-4000-8000-000000000001",
    );
    expect(screen.getByRole("search").getAttribute("action")).toBe("/paperwork/locations/10ca0000-0000-4000-8000-000000000001");
  });
});

describe("screen 5: unfiled (REQ-100)", () => {
  it("lists each unfiled document's name, owner and logged date, with File it", async () => {
    given();
    render(await UnfiledPage({ searchParams: q() }));
    const row = within(screen.getByRole("list", { name: "Unfiled documents" }))
      .getAllByRole("listitem")
      .at(-1)!;
    for (const text of ["Water bill notice", "Sam", "Logged 2026-09-20"])
      expect(within(row).getByText(text)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "File Water bill notice" }));
    expect(screen.getByRole("dialog", { name: "File Water bill notice" })).toBeDefined();
  });
});

describe("flows (REQ-100)", () => {
  it("logs a document in a sheet over the screen, which closes once it's saved", async () => {
    const fake = given();
    render(await openFile("f-42"));
    fireEvent.click(screen.getByRole("button", { name: "Log document" }));
    const sheet = screen.getByRole("dialog", { name: "Log document" });
    for (const label of [
      "Name",
      "Owner",
      "Document date (optional)",
      "Notes (optional)",
      "File",
      "Keep until (optional)",
    ]) {
      expect(within(sheet).getByLabelText(label), label).toBeDefined();
    }
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Car insurance renewal" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Log document" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log document" })).toBeNull());
    expect(fake.from).toHaveBeenCalledWith("paperwork");
    // Still on the file.
    expect(screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" })).toBeDefined();
  });

  it("shows a new file's label once, and closing it leaves you where you were", async () => {
    given();
    render(await home());
    fireEvent.click(screen.getByRole("button", { name: "Log document" }));
    const sheet = screen.getByRole("dialog", { name: "Log document" });
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Car title" } });
    fireEvent.change(within(sheet).getByLabelText("File"), { target: { value: "new" } });
    fireEvent.change(within(sheet).getByLabelText("Category"), { target: { value: CAR.id } });
    fireEvent.change(within(sheet).getByLabelText("Location"), { target: { value: "10ca0000-0000-4000-8000-000000000002" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Log document" }));
    });
    const notice = await screen.findByRole("dialog", { name: "New file: print its label" });
    // The stand-in database hands back its first file row as the new one.
    expect(within(notice).getByLabelText(/^Label: F-/)).toBeDefined();
    fireEvent.click(within(notice).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "New file: print its label" })).toBeNull();
    expect(screen.getByRole("region", { name: "Locations" })).toBeDefined();
  });
});

describe("keep-until pre-fills from the file's category (REQ-97)", () => {
  const files = FILES.map((row) => ({ ...row, status: "active" as const, is_drive: false, drive_folder_id: null }));
  const renderForm = () =>
    render(<PaperForm people={PEOPLE} files={files} categories={[CAR, TAXES]} locations={[HALL]} today="2026-09-24" />);
  const keep = () => screen.getByLabelText("Keep until (optional)") as HTMLInputElement;

  it("from the document date plus the category's years", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Document date (optional)"), { target: { value: "2025-04-15" } });
    fireEvent.change(screen.getByLabelText("File"), { target: { value: "f-42" } });
    expect(keep().value).toBe("2032-04-15");
  });

  it("from the day it's logged when there's no document date", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("File"), { target: { value: "f-42" } });
    expect(keep().value).toBe("2033-09-24");
  });

  it("stays as typed once someone edits or clears it", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("File"), { target: { value: "f-42" } });
    fireEvent.change(keep(), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Document date (optional)"), { target: { value: "2020-01-01" } });
    expect(keep().value).toBe("");
  });

  it("for a new file, from the category chosen for it, which asks for a location too", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("File"), { target: { value: "new" } });
    expect(screen.getByLabelText("Location")).toBeDefined();
    expect(screen.getByLabelText("Label name (optional)")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c-tax" } });
    expect(keep().value).toBe("2033-09-24");
  });
});

describe("Paperwork settings (REQ-88, DESIGN.md §11)", () => {
  it("are locked for a member", async () => {
    given();
    render(await PaperworkSettingsPage({}));
    expect(card("Settings").textContent).toContain("Admin only");
    expect(screen.queryByRole("button", { name: "Add the category" })).toBeNull();
  });

  it("let the admin add, edit and remove categories, with how long each keeps and how many files use it", async () => {
    given(ADMIN);
    render(await PaperworkSettingsPage({}));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Paperwork — Settings");
    const tabs = screen.getByRole("navigation", { name: "Paperwork sections" });
    expect(within(tabs).queryByRole("link", { current: "page" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add the category" })).toBeDefined();
    const [car, taxes] = within(card("Categories")).getAllByRole("listitem");
    expect(car.textContent).toContain("No default");
    expect(taxes.textContent).toContain("Keep 7 yr");
    expect(taxes.textContent).toContain("2 files");
    // Removing Taxes asks where its files go first.
    expect(within(taxes).getByLabelText("Move its 2 files to")).toBeDefined();
    expect(within(taxes).getByRole("button", { name: "Move the files and remove Taxes" })).toBeDefined();
  });
});

describe("browsing by category (REQ-105)", () => {
  // Taxes across two places, with 2021-2022 missing and one undated.
  const dated = (id: string, name: string, file_id: string, date: string | null, owner: string | null = null) => ({
    ...paper(id, name, file_id, owner),
    document_date: date,
  });
  const TAX_PAPERS = [
    dated("t1", "Federal return", "f-42", "2024-04-15"),
    dated("t2", "W-2", "f-42", "2024-01-31", "u-alex"),
    dated("t3", "Federal return", "f-42", "2023-04-15"),
    dated("t4", "Federal return", "f-9", "2020-04-15"),
    dated("t5", "Old receipt", "f-9", null, "u-sam"),
    dated("c1", "Car title", "f-7", "2019-06-01"),
    paper("d1", "Water bill notice", null),
  ];
  const openCategory = (id: string) => CategoryPage({ params: Promise.resolve({ id }) });

  it("shows everyone a card per category with its files and documents", async () => {
    given(["use_modules"], { papers: TAX_PAPERS });
    render(await CategoriesPage({}));
    expect(
      within(screen.getByRole("navigation", { name: "Paperwork sections" })).getByRole("link", { current: "page" })
        .textContent,
    ).toBe("Categories");
    expect(links(card("Categories"))).toEqual([
      ["Car2 files · 1 document", `/paperwork/categories/${CAR.id}`],
      ["Taxes2 files · 5 documents", "/paperwork/categories/c-tax"],
    ]);
    expect(screen.queryByRole("button", { name: "Add the category" })).toBeNull();
  });

  it("opens a category under a breadcrumb, with its files, documents and keep-for", async () => {
    given(["use_modules"], { papers: TAX_PAPERS });
    render(await openCategory("c-tax"));
    expect(crumbs()).toEqual(["Paperwork", "Categories", "Taxes"]);
    expect(card("Taxes summary").textContent).toBe("Files2Documents5Keep for7 years");
    cleanup();
    render(await openCategory(CAR.id));
    expect(card("Car summary").textContent).toBe("Files2Documents1");
  });

  it("lists its documents from every file and place by year, newest first, with gaps named and undated last", async () => {
    given(["use_modules"], { papers: TAX_PAPERS });
    render(await openCategory("c-tax"));
    const years = within(card("Documents by year"))
      .getAllByRole("listitem")
      .filter((row) => row.querySelector("span")?.className.includes("year"))
      .map((row) => row.firstElementChild?.textContent);
    expect(years).toEqual(["2024", "2023", "2022", "2021", "2020", "No date"]);
    expect(within(card("Documents by year")).getByText("Nothing logged for 2022")).toBeDefined();
    expect(within(card("Documents by year")).getByText("Nothing logged for 2021")).toBeDefined();
    const docs = within(card("Documents by year")).getAllByRole("link");
    expect(docs.map((doc) => [doc.textContent, doc.getAttribute("href")])).toEqual([
      ["Federal returnJointF-0042 · Hall cupboard", "/paperwork/items/t1"],
      ["W-2AlexF-0042 · Hall cupboard", "/paperwork/items/t2"],
      ["Federal returnJointF-0042 · Hall cupboard", "/paperwork/items/t3"],
      ["Federal returnJointF-0009 · Box S-003 · Shoes", "/paperwork/items/t4"],
      ["Old receiptSamF-0009 · Box S-003 · Shoes", "/paperwork/items/t5"],
    ]);
  });

  it("is not found for a category that doesn't exist", async () => {
    given();
    await expect(openCategory("c-none")).rejects.toThrow("NOT_FOUND");
  });
});

// #238: only the home says "Overview" under the module's name; a page
// under no tab is named by its own crumb.
describe("where you are, under the module's name", () => {
  const where = () => screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent;

  it("says Overview only at home, and the page's own name elsewhere", async () => {
    given();
    render(await home());
    expect(where()).toBe("Overview");
    cleanup();
    render(await place("10ca0000-0000-4000-8000-000000000001"));
    expect(where()).toBe("Hall cupboard");
    cleanup();
    render(await BoxPage({ params: Promise.resolve({ id: "s3" }), searchParams: q() }));
    expect(where()).toBe("Box S-003 · Shoes");
    cleanup();
    render(await openFile("f-42"));
    expect(where()).toBe("F-0042");
    cleanup();
    render(await home("taxes"));
    expect(where()).toBe("Results for “taxes”");
    cleanup();
    render(await UnfiledPage({ searchParams: q() }));
    expect(where()).toBe("Unfiled");
  });
});

describe("archiving single documents (REQ-153)", () => {
  // The lease sits in the Shoes box's archive, not in any file.
  const LEASE = { ...paper("p5", "Old lease", null, "u-sam"), archive_id: "a3" };
  const withArchive = () => given(["use_modules"], { papers: [...PAPERS, LEASE], archives: [SHOES_ARCHIVE] });
  const item = (id: string) => PaperPage({ params: Promise.resolve({ id }) });

  it("offers Archive on a filed or an unfiled document, choosing a box", async () => {
    for (const id of ["p1", "p3"]) {
      given();
      render(await item(id));
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
      const sheet = screen.getByRole("dialog", { name: /^Archive / });
      const box = within(sheet).getByLabelText("Box");
      expect(within(box).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a box", "S-003 · Shoes"]);
      cleanup();
    }
  });

  it("offers Bring back, not Archive or Move, for an archived document", async () => {
    withArchive();
    render(await item("p5"));
    expect(screen.getByRole("button", { name: "Bring back" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move to another file" })).toBeNull();
    expect(crumbs()).toEqual(["Paperwork", "Box S-003 · Shoes", "Archive · S-003", "Old lease"]);
  });

  it("keeps an archived document off the unfiled list and out of Home's count", async () => {
    withArchive();
    render(await UnfiledPage({ searchParams: q() }));
    const list = screen.getByRole("list", { name: "Unfiled documents" });
    expect(within(list).queryByText("Old lease")).toBeNull();
    expect(within(list).getByText("Water bill notice")).toBeDefined();
  });

  it("shows the archive on its box's card and page, as a file with no ID, label or category", async () => {
    withArchive();
    render(await home());
    expect(links(card("Archived in storage"))).toEqual([
      ["Box S-003 · Shoes2 files · 2 documents", "/paperwork/boxes/s3"],
    ]);
    cleanup();
    render(await BoxPage({ params: Promise.resolve({ id: "s3" }), searchParams: q() }));
    expect(
      links(screen.getByRole("main")).filter(([, href]) => href?.startsWith("/paperwork/archives/") || href?.startsWith("/paperwork/files/")),
    ).toEqual([
      ["Archive · S-003No label1 document", "/paperwork/archives/a3"],
      ["F-0009 · TaxesOld returns1 document", "/paperwork/files/f-9"],
    ]);
  });

  it("makes a card for a box that holds only an archive", async () => {
    given(["use_modules"], { files: FILES, papers: [...PAPERS, LEASE], archives: [SHOES_ARCHIVE] });
    render(await home());
    expect(links(card("Archived in storage"))).toEqual([["Box S-003 · Shoes1 file · 1 document", "/paperwork/boxes/s3"]]);
  });

  it("opens the archive to list its documents, with nothing to manage", async () => {
    withArchive();
    render(await ArchivePage({ params: Promise.resolve({ id: "a3" }), searchParams: q() }));
    expect(screen.getByRole("heading", { level: 2, name: "Archive · S-003" })).toBeDefined();
    expect(links(screen.getByRole("list", { name: "Documents in this archive" }))).toEqual([
      ["Old leaseSamNo dateKeep", "/paperwork/items/p5"],
    ]);
    for (const name of ["Manage file", "Archive", "Add document"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(crumbs()).toEqual(["Paperwork", "Box S-003 · Shoes", "Archive · S-003"]);
  });

  it("shows an archived document in search as in the archive, in its box", async () => {
    withArchive();
    render(await home("lease"));
    expect(within(card("Documents")).getByRole("link", { name: /Old lease/ }).textContent).toBe(
      "Old leaseArchive · S-003Box S-003 · Shoes",
    );
  });
});
