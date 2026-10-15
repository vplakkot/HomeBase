// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import BoxPage from "./boxes/[id]/page";
import CategoryPage from "./categories/[id]/page";
import CategoriesPage from "./categories/page";
import FileFolderPage from "./file-folders/[id]/page";
import { PaperForm } from "./forms";
import PaperPage from "./items/[id]/page";
import ArchivePage from "./archives/[id]/page";
import NotPlacedPage from "./not-placed/page";
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
// A real-looking id, since making a File Folder checks the category's id.
const CAR = { id: "c0ca0000-0000-4000-8000-000000000001", name: "Car", keep_years: null };
// Locations are records (REQ-179); the shed has no File Folders.
const HALL = { id: "10ca0000-0000-4000-8000-000000000001", name: "Hall cupboard", built_in: null };
const GLOVEBOX = { id: "10ca0000-0000-4000-8000-000000000002", name: "Glovebox" };
const SHED = { id: "10ca0000-0000-4000-8000-000000000003", name: "Shed" };
const fileFolder = (id: string, number: number, category_id: string, label: string | null, location_id: string | null) => ({
  id,
  number,
  category_id,
  location_id,
  label,
  status: "active",
  storage_entry_id: null,
});
const FILES = [
  fileFolder("f-42", 42, "c-tax", "Returns", HALL.id),
  fileFolder("f-7", 7, CAR.id, null, GLOVEBOX.id),
  fileFolder("f-43", 43, CAR.id, null, HALL.id),
];
const ARCHIVED = {
  ...fileFolder("f-9", 9, "c-tax", "Old returns", HALL.id),
  status: "archived",
  storage_entry_id: "s3",
};
const paper = (id: string, name: string, file_folder_id: string | null, owner_id: string | null = null) => ({
  id,
  name,
  owner_id,
  document_date: null as string | null,
  notes: null,
  keep_until: null as string | null,
  file_folder_id,
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
  { fileFolders = [...FILES, ARCHIVED], papers = PAPERS, archives = [] as unknown[] } = {},
) {
  const fake = fakeSupabase({
    permissions,
    people: PEOPLE,
    tables: {
      paperwork_categories: [CAR, TAXES],
      paperwork_file_folders: fileFolders,
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
const openFileFolder = (id: string) => FileFolderPage({ params: Promise.resolve({ id }), searchParams: q() });
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

  it("puts search, the settings gear, New File Folder and Log document in the header of every screen", async () => {
    given(ADMIN);
    for (const page of [
      home(),
      place("10ca0000-0000-4000-8000-000000000001"),
      openFileFolder("f-42"),
      UnfiledPage({ searchParams: q() }),
      CategoriesPage({}),
    ]) {
      render(await page);
      const header = screen.getByRole("banner");
      expect(within(header).getByRole("searchbox", { name: "Search File Folders and documents" })).toBeDefined();
      expect(within(header).getByRole("link", { name: "Paperwork settings" }).getAttribute("href")).toBe(
        "/paperwork/settings",
      );
      expect(within(header).getByRole("button", { name: "Log document" })).toBeDefined();
      // #254: a File Folder can be made on its own, not only from Log document.
      expect(within(header).getByRole("button", { name: "New File Folder" })).toBeDefined();
      cleanup();
    }
  });

  it("opens the New File Folder form from the header (#254)", async () => {
    given();
    render(await home());
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "New File Folder" }));
    expect(screen.getByRole("dialog", { name: "New File Folder" })).toBeDefined();
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
    render(await openFileFolder("f-42"));
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

  it("sums up locations, File Folders and documents", async () => {
    given();
    render(await home());
    expect(card("Summary").textContent).toBe("Locations4File Folders4Documents4");
  });

  it("has a card per location with its File Folder and document counts, an empty one too (REQ-179)", async () => {
    given();
    render(await home());
    expect(links(card("Locations"))).toEqual([
      ["Glovebox1 File Folder · 0 documents", "/paperwork/locations/10ca0000-0000-4000-8000-000000000002"],
      ["Hall cupboard2 File Folders · 2 documents", "/paperwork/locations/10ca0000-0000-4000-8000-000000000001"],
      ["Shed0 File Folders · 0 documents", "/paperwork/locations/10ca0000-0000-4000-8000-000000000003"],
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

  it("puts each box holding archived File Folders under Archived in storage, below", async () => {
    given();
    render(await home());
    expect(links(card("Archived in storage"))).toEqual([
      ["Box S-003 · Shoes1 File Folder · 1 document", "/paperwork/boxes/s3"],
    ]);
  });

  it("has no Archived in storage heading when nothing is archived", async () => {
    given(["use_modules"], { fileFolders: FILES });
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
    given(["use_modules"], { papers: PAPERS.filter((row) => row.file_folder_id) });
    render(await home());
    expect(screen.queryByRole("region", { name: /Action items/ })).toBeNull();
  });
});

describe("File Folders not placed yet (REQ-206)", () => {
  const LOOSE = fileFolder("f-60", 60, "c-tax", "Shoebox of receipts", null);
  const LOOSE_TWO = fileFolder("f-61", 61, CAR.id, null, null);

  it("shows a Not placed section with its count beside the locations, and an action item (REQ-206)", async () => {
    given(["use_modules"], { fileFolders: [...FILES, LOOSE, LOOSE_TWO] });
    render(await home());
    expect(links(card("Not placed"))).toEqual([["Not placed2 File Folders · 0 documents", "/paperwork/not-placed"]]);
    const items = card("Action items 2");
    expect(within(items).getByRole("link", { name: "Place them" }).getAttribute("href")).toBe("/paperwork/not-placed");
    expect(within(items).getByText("2 File Folders not placed")).toBeDefined();
    // Not placed isn't a location.
    expect(card("Summary").textContent).toBe("Locations3File Folders5Documents4");
  });

  it("has no section or action item once every File Folder has a place", async () => {
    given();
    render(await home());
    expect(screen.queryByRole("region", { name: "Not placed" })).toBeNull();
    expect(screen.queryByText(/not placed/)).toBeNull();
  });

  it("lists them on the Not placed screen, and opens each one", async () => {
    given(["use_modules"], { fileFolders: [...FILES, LOOSE] });
    render(await NotPlacedPage({ searchParams: q() }));
    expect(crumbs()).toEqual(["Paperwork", "Not placed"]);
    expect(links(card("Not placed"))).toEqual([["F-0060 · TaxesShoebox of receipts0 documents", "/paperwork/file-folders/f-60"]]);
  });

  it("says Not placed on the File Folder's own screen", async () => {
    given(["use_modules"], { fileFolders: [...FILES, LOOSE] });
    render(await openFileFolder("f-60"));
    expect(screen.getByRole("main").textContent).toContain("Not placed");
  });

  it("lets the location be skipped when making one, and chosen as Not placed when managing one", async () => {
    given(["use_modules"], { fileFolders: [...FILES, LOOSE] });
    render(await openFileFolder("f-60"));
    fireEvent.click(screen.getByRole("button", { name: "Manage File Folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit category, label or location" }));
    const picker = screen.getByLabelText("Location") as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect(picker.required).toBe(false);
    expect(within(picker).getAllByRole("option")[0].textContent).toBe("Not placed");
  });
});

describe("screen 2: File Folders in a place (REQ-100)", () => {
  it("shows every File Folder there as ID · category, label name or No label, and document count", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000001"));
    expect(screen.getByRole("heading", { level: 2, name: "Hall cupboard" })).toBeDefined();
    expect(links(screen.getByRole("main")).filter(([, href]) => href?.startsWith("/paperwork/file-folders/"))).toEqual([
      ["F-0042 · TaxesReturns2 documents", "/paperwork/file-folders/f-42"],
      ["F-0043 · CarNo label0 documents", "/paperwork/file-folders/f-43"],
    ]);
  });

  it("has Manage location with Rename, and Delete only when it has no File Folders (REQ-179)", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000001"));
    fireEvent.click(screen.getByRole("button", { name: "Manage location" }));
    const menu = screen.getByRole("list", { name: "Manage location" });
    expect(within(menu).getByRole("button", { name: "Rename" })).toBeDefined();
    expect(within(menu).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(menu.textContent).toContain("It must be empty before it can be deleted.");
  });

  it("counts a File Folder archived in storage as still in its location, so Delete stays unavailable (REQ-179)", async () => {
    // Only the archived File Folder is left in the hall cupboard.
    given(["use_modules"], { fileFolders: [ARCHIVED] });
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

  it("is not found for a place with no File Folders", async () => {
    given();
    await expect(place("Garage")).rejects.toThrow("NOT_FOUND");
  });
});

describe("screen 3: a File Folder (REQ-100)", () => {
  it("heads with ID · category, label name, location and plain-text status, then lists every document", async () => {
    given();
    render(await openFileFolder("f-42"));
    expect(screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" })).toBeDefined();
    const facts = screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" }).nextElementSibling?.textContent;
    expect(facts).toBe("Returns·Hall cupboard·Active");
    const rows = within(screen.getByRole("list", { name: "Documents in this File Folder" })).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual([
      "2024 federal returnAlexNo dateKeep",
      "2023 federal returnJointNo dateKeep",
    ]);
  });

  it("shows an archived File Folder as Archived, in its box", async () => {
    given();
    render(await openFileFolder("f-9"));
    expect(screen.getByRole("heading", { level: 2, name: "F-0009 · Taxes" }).nextElementSibling?.textContent).toBe(
      "Old returns·Box S-003 · Shoes·Archived",
    );
  });

  it("shows no edit forms until Manage File Folder is opened, then one menu of four", async () => {
    given();
    render(await openFileFolder("f-42"));
    expect(screen.queryByLabelText("Location")).toBeNull();
    const manage = screen.getByRole("button", { name: "Manage File Folder" });
    expect(manage.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(manage);
    const menu = screen.getByRole("list", { name: "Manage File Folder" });
    expect(
      within(menu)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Edit category, label or location", "Show label to reprint", "Archive to a storage box", "Remove File Folder"]);
  });

  it("edits the File Folder, shows its label, archives it (boxes only) or removes it, each in a sheet", async () => {
    given();
    render(await openFileFolder("f-42"));
    const pick = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Manage File Folder" }));
      fireEvent.click(screen.getByRole("button", { name }));
    };
    pick("Edit category, label or location");
    // A pick from the locations, never free text (REQ-179).
    const picker = screen.getByLabelText("Location") as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    expect(picker.value).toBe("10ca0000-0000-4000-8000-000000000001");
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Not placed",
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
    pick("Remove File Folder");
    expect(screen.getByRole("button", { name: "Yes, remove the File Folder" })).toBeDefined();
    // Removing leaves you in the File Folder's location.
    const back = document.querySelector("input[name=returnTo]") as HTMLInputElement;
    expect(back.value).toBe("/paperwork/locations/10ca0000-0000-4000-8000-000000000001");
  });

  it("offers Restore from storage for an archived File Folder", async () => {
    given();
    render(await openFileFolder("f-9"));
    fireEvent.click(screen.getByRole("button", { name: "Manage File Folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore from storage" }));
    expect(screen.getByLabelText("New location")).toBeDefined();
  });

  it("lets a File Folder's location be a new one made on the spot, named beside the list (REQ-179)", async () => {
    given();
    render(await openFileFolder("f-42"));
    fireEvent.click(screen.getByRole("button", { name: "Manage File Folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit category, label or location" }));
    expect(screen.queryByLabelText("New location name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "new" } });
    expect(screen.getByLabelText("New location name")).toBeDefined();
  });

  it("adds a document straight into the File Folder: the form has no File Folder to choose", async () => {
    given();
    render(await openFileFolder("f-42"));
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    const sheet = screen.getByRole("dialog", { name: "Add document" });
    expect(within(sheet).queryByLabelText("File Folder")).toBeNull();
    const hidden = sheet.querySelector("input[name=fileFolderId]") as HTMLInputElement;
    expect(hidden.value).toBe("f-42");
  });

  it("opens a paper's details to edit any field, and Move to another File Folder from there", async () => {
    given();
    render(await PaperPage({ params: Promise.resolve({ id: "p1" }) }));
    expect(crumbs()).toEqual(["Paperwork", "Hall cupboard", "F-0042", "2024 federal return"]);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("2024 federal return");
    expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("u-alex");
    expect(screen.queryByLabelText("File Folder")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move to another File Folder" }));
    const move = within(screen.getByRole("dialog", { name: "Move to another File Folder" })).getByLabelText("Move to");
    const options = within(move)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toContain("Unfiled");
    expect(options).toContain("F-0007 · Car");
    expect(options.some((option) => option?.startsWith("F-0042"))).toBe(false);
  });
});

describe("screen 4: search (REQ-100)", () => {
  it("replaces the screen with results in File Folders and Documents", async () => {
    given();
    render(await place("10ca0000-0000-4000-8000-000000000001", "return"));
    expect(screen.queryByRole("heading", { level: 2, name: "Hall cupboard" })).toBeNull();
    expect(crumbs()).toEqual(["Paperwork", "Results for “return”"]);
    expect(card("File Folders").textContent).toContain("2 File Folders");
    expect(card("Documents").textContent).toContain("3 documents");
  });

  it("matches File Folder ID, label name and category", async () => {
    given();
    for (const [query, want] of [
      ["F-0042", "F-0042 · Taxes"],
      ["returns", "F-0042 · Taxes"],
      ["car", "F-0043 · Car"],
    ]) {
      render(await home(query));
      expect(screen.getByRole("region", { name: /^File Folders/ }).textContent, query).toContain(want);
      cleanup();
    }
  });

  it("shows each document's File Folder ID and where it is, Unfiled / Your desk when it has none", async () => {
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
    render(await openFileFolder("f-42"));
    fireEvent.click(screen.getByRole("button", { name: "Log document" }));
    const sheet = screen.getByRole("dialog", { name: "Log document" });
    for (const label of [
      "Name",
      "Owner",
      "Document date (optional)",
      "Notes (optional)",
      "File Folder",
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
    // Still on the File Folder.
    expect(screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" })).toBeDefined();
  });

  it("shows a new File Folder's label once, and closing it leaves you where you were", async () => {
    given();
    render(await home());
    fireEvent.click(screen.getByRole("button", { name: "Log document" }));
    const sheet = screen.getByRole("dialog", { name: "Log document" });
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Car title" } });
    fireEvent.change(within(sheet).getByLabelText("File Folder"), { target: { value: "new" } });
    fireEvent.change(within(sheet).getByLabelText("Category"), { target: { value: CAR.id } });
    fireEvent.change(within(sheet).getByLabelText("Location"), { target: { value: "10ca0000-0000-4000-8000-000000000002" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Log document" }));
    });
    const notice = await screen.findByRole("dialog", { name: "New File Folder: print its label" });
    // The stand-in database hands back its first File Folder row as the new one.
    expect(within(notice).getByLabelText(/^Label: F-/)).toBeDefined();
    fireEvent.click(within(notice).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "New File Folder: print its label" })).toBeNull();
    expect(screen.getByRole("region", { name: "Locations" })).toBeDefined();
  });
});

describe("keep-until pre-fills from the File Folder's category (REQ-97)", () => {
  const fileFolders = FILES.map((row) => ({ ...row, status: "active" as const, is_drive: false, drive_folder_id: null }));
  const renderForm = () =>
    render(<PaperForm people={PEOPLE} fileFolders={fileFolders} categories={[CAR, TAXES]} locations={[HALL]} today="2026-09-24" />);
  const keep = () => screen.getByLabelText("Keep until (optional)") as HTMLInputElement;

  it("from the document date plus the category's years", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Document date (optional)"), { target: { value: "2025-04-15" } });
    fireEvent.change(screen.getByLabelText("File Folder"), { target: { value: "f-42" } });
    expect(keep().value).toBe("2032-04-15");
  });

  it("from the day it's logged when there's no document date", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("File Folder"), { target: { value: "f-42" } });
    expect(keep().value).toBe("2033-09-24");
  });

  it("stays as typed once someone edits or clears it", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("File Folder"), { target: { value: "f-42" } });
    fireEvent.change(keep(), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Document date (optional)"), { target: { value: "2020-01-01" } });
    expect(keep().value).toBe("");
  });

  it("for a new File Folder, from the category chosen for it, which asks for a location too", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("File Folder"), { target: { value: "new" } });
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

  it("let the admin add, edit and remove categories, with how long each keeps and how many File Folders use it", async () => {
    given(ADMIN);
    render(await PaperworkSettingsPage({}));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Paperwork — Settings");
    const tabs = screen.getByRole("navigation", { name: "Paperwork sections" });
    expect(within(tabs).queryByRole("link", { current: "page" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add the category" })).toBeDefined();
    const [car, taxes] = within(card("Categories")).getAllByRole("listitem");
    expect(car.textContent).toContain("No default");
    expect(taxes.textContent).toContain("Keep 7 yr");
    expect(taxes.textContent).toContain("2 File Folders");
    // Removing Taxes asks where its File Folders go first.
    expect(within(taxes).getByLabelText("Move its 2 File Folders to")).toBeDefined();
    expect(within(taxes).getByRole("button", { name: "Move the File Folders and remove Taxes" })).toBeDefined();
  });
});

describe("browsing by category (REQ-105)", () => {
  // Taxes across two places, with 2021-2022 missing and one undated.
  const dated = (id: string, name: string, file_folder_id: string, date: string | null, owner: string | null = null) => ({
    ...paper(id, name, file_folder_id, owner),
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

  it("shows everyone a card per category with its File Folders and documents", async () => {
    given(["use_modules"], { papers: TAX_PAPERS });
    render(await CategoriesPage({}));
    expect(
      within(screen.getByRole("navigation", { name: "Paperwork sections" })).getByRole("link", { current: "page" })
        .textContent,
    ).toBe("Categories");
    expect(links(card("Categories"))).toEqual([
      ["Car2 File Folders · 1 document", `/paperwork/categories/${CAR.id}`],
      ["Taxes2 File Folders · 5 documents", "/paperwork/categories/c-tax"],
    ]);
    expect(screen.queryByRole("button", { name: "Add the category" })).toBeNull();
  });

  it("opens a category under a breadcrumb, with its File Folders, documents and keep-for", async () => {
    given(["use_modules"], { papers: TAX_PAPERS });
    render(await openCategory("c-tax"));
    expect(crumbs()).toEqual(["Paperwork", "Categories", "Taxes"]);
    expect(card("Taxes summary").textContent).toBe("File Folders2Documents5Keep for7 years");
    cleanup();
    render(await openCategory(CAR.id));
    expect(card("Car summary").textContent).toBe("File Folders2Documents1");
  });

  // REQ-204: every File Folder of the category, whatever its place, each
  // collapsed to start; Expand lists its documents.
  const folderRows = () =>
    within(screen.getByRole("list", { name: "Taxes File Folders" }))
      .getAllByRole("listitem")
      .filter((row) => row.querySelector(":scope > div"))
      .map((row) => (row.querySelector(":scope > div") as HTMLElement).textContent);

  it("lists every File Folder in the category with ID, label name, place and document count, sorted by label (REQ-204)", async () => {
    given(["use_modules"], { papers: TAX_PAPERS, fileFolders: [...FILES, ARCHIVED, fileFolder("f-50", 50, "c-tax", null, HALL.id), fileFolder("f-51", 51, "c-tax", null, null)] });
    render(await openCategory("c-tax"));
    expect(folderRows()).toEqual([
      "F-0009Old returnsArchivedBox S-003 · Shoes2 documentsExpand",
      "F-0042ReturnsHall cupboard3 documentsExpand",
      "F-0050No labelHall cupboard0 documentsExpand",
      "F-0051No labelNot placed0 documentsExpand",
    ]);
  });

  it("starts collapsed; Expand shows documents by keep-until, soonest first, and Collapse hides them (REQ-204)", async () => {
    const keep = (id: string, name: string, until: string | null) => ({ ...paper(id, name, "f-42"), keep_until: until });
    given(["use_modules"], {
      papers: [keep("k1", "Zed", null), keep("k2", "Lease", "2031-01-01"), keep("k3", "Alpha", null), keep("k4", "W-2", "2027-03-01")],
    });
    render(await openCategory("c-tax"));
    expect(screen.queryByRole("list", { name: "Documents in F-0042" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand F-0042" }));
    const docs = within(screen.getByRole("list", { name: "Documents in F-0042" })).getAllByRole("link");
    expect(docs.map((doc) => [doc.textContent, doc.getAttribute("href")])).toEqual([
      ["W-2JointNo dateKeep until 2027-03-01", "/paperwork/items/k4"],
      ["LeaseJointNo dateKeep until 2031-01-01", "/paperwork/items/k2"],
      ["AlphaJointNo dateKeep", "/paperwork/items/k3"],
      ["ZedJointNo dateKeep", "/paperwork/items/k1"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse F-0042" }));
    expect(screen.queryByRole("list", { name: "Documents in F-0042" })).toBeNull();
  });

  it("opens the File Folder from its ID or name, not from Expand (REQ-204)", async () => {
    given(["use_modules"], { papers: TAX_PAPERS });
    render(await openCategory("c-tax"));
    const link = screen.getAllByRole("link").find((one) => one.textContent === "F-0042Returns");
    expect(link?.getAttribute("href")).toBe("/paperwork/file-folders/f-42");
  });

  it("no longer groups by year or names gaps (REQ-204)", async () => {
    given(["use_modules"], { papers: TAX_PAPERS });
    render(await openCategory("c-tax"));
    expect(screen.queryByText(/Nothing logged for/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Documents by year" })).toBeNull();
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
    render(await openFileFolder("f-42"));
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
  // The lease sits in the Shoes box's archive, not in any File Folder.
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

  it("offers Restore, not Archive or Move, for an archived document", async () => {
    withArchive();
    render(await item("p5"));
    expect(screen.getByRole("button", { name: "Restore" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move to another File Folder" })).toBeNull();
    expect(crumbs()).toEqual(["Paperwork", "Box S-003 · Shoes", "Archive · S-003", "Old lease"]);
  });

  it("keeps an archived document off the unfiled list and out of Home's count", async () => {
    withArchive();
    render(await UnfiledPage({ searchParams: q() }));
    const list = screen.getByRole("list", { name: "Unfiled documents" });
    expect(within(list).queryByText("Old lease")).toBeNull();
    expect(within(list).getByText("Water bill notice")).toBeDefined();
  });

  it("shows the archive on its box's card and page, as a File Folder with no ID, label or category", async () => {
    withArchive();
    render(await home());
    expect(links(card("Archived in storage"))).toEqual([
      ["Box S-003 · Shoes2 File Folders · 2 documents", "/paperwork/boxes/s3"],
    ]);
    cleanup();
    render(await BoxPage({ params: Promise.resolve({ id: "s3" }), searchParams: q() }));
    expect(
      links(screen.getByRole("main")).filter(([, href]) => href?.startsWith("/paperwork/archives/") || href?.startsWith("/paperwork/file-folders/")),
    ).toEqual([
      ["Archive · S-003No label1 document", "/paperwork/archives/a3"],
      ["F-0009 · TaxesOld returns1 document", "/paperwork/file-folders/f-9"],
    ]);
  });

  it("makes a card for a box that holds only an archive", async () => {
    given(["use_modules"], { fileFolders: FILES, papers: [...PAPERS, LEASE], archives: [SHOES_ARCHIVE] });
    render(await home());
    expect(links(card("Archived in storage"))).toEqual([["Box S-003 · Shoes1 File Folder · 1 document", "/paperwork/boxes/s3"]]);
  });

  it("opens the archive to list its documents, with nothing to manage", async () => {
    withArchive();
    render(await ArchivePage({ params: Promise.resolve({ id: "a3" }), searchParams: q() }));
    expect(screen.getByRole("heading", { level: 2, name: "Archive · S-003" })).toBeDefined();
    expect(links(screen.getByRole("list", { name: "Documents in this archive" }))).toEqual([
      ["Old leaseSamNo dateKeep", "/paperwork/items/p5"],
    ]);
    for (const name of ["Manage File Folder", "Archive", "Add document"]) {
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
