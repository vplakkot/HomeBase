// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import BoxPage from "./boxes/[id]/page";
import CategoriesPage from "./categories/page";
import FilePage from "./files/[id]/page";
import { PaperForm } from "./forms";
import PaperPage from "./items/[id]/page";
import LocationPage from "./locations/[name]/page";
import PaperworkPage from "./page";
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
const file = (id: string, number: number, category_id: string, label: string | null, location: string) => ({
  id,
  number,
  category_id,
  location,
  label,
  status: "active",
  storage_entry_id: null,
});
// Two spellings of the hall cupboard are one place.
const FILES = [
  file("f-42", 42, "c-tax", "Returns", "Hall cupboard"),
  file("f-7", 7, CAR.id, null, "Glovebox"),
  file("f-43", 43, CAR.id, null, "hall  cupboard"),
];
const ARCHIVED = { ...file("f-9", 9, "c-tax", "Old returns", "Hall cupboard"), status: "archived", storage_entry_id: "s3" };
const paper = (id: string, name: string, file_id: string | null, owner_id: string | null = null) => ({
  id,
  name,
  owner_id,
  document_date: null,
  notes: null,
  keep_until: null,
  file_id,
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

function given(permissions = ["use_modules"], { files = [...FILES, ARCHIVED], papers = PAPERS } = {}) {
  const fake = fakeSupabase({
    permissions,
    people: PEOPLE,
    tables: {
      paperwork_categories: [CAR, TAXES],
      paperwork_files: files,
      paperwork: papers,
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
const place = (name: string, query?: string) =>
  LocationPage({ params: Promise.resolve({ name: encodeURIComponent(name) }), searchParams: q(query) });
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
  // Vin kept the top bar (2026-09-24), over REQ-100's "tabs removed":
  // it's how every module is found, and two ways to one place is fine.
  it("keeps the top bar: Overview, Unfiled and Categories", async () => {
    given(ADMIN);
    render(await home());
    const tabs = screen.getByRole("navigation", { name: "Paperwork sections" });
    expect(links(tabs)).toEqual([
      ["Overview", "/paperwork"],
      ["Unfiled", "/paperwork/unfiled"],
      ["CategoriesAdmin only", "/paperwork/categories"],
    ]);
  });

  it("puts search and Log paperwork in the header of every screen", async () => {
    given(ADMIN);
    for (const page of [home(), place("Hall cupboard"), openFile("f-42"), UnfiledPage({ searchParams: q() })]) {
      render(await page);
      expect(screen.getByRole("searchbox", { name: "Search Paperwork" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Log paperwork" })).toBeDefined();
      cleanup();
    }
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
      ["Hall cupboard", "/paperwork/locations/Hall%20cupboard"],
    ]);
    expect(within(trail).getByText("F-0042").getAttribute("aria-current")).toBe("page");
  });
});

describe("screen 1: locations (REQ-100)", () => {
  it("has a card per office location with its file and item counts, one spelling per place", async () => {
    given();
    render(await home());
    expect(links(card("Where your files are"))).toEqual([
      ["Glovebox1 file · 0 items", "/paperwork/locations/Glovebox"],
      ["Hall cupboard2 files · 2 items", "/paperwork/locations/Hall%20cupboard"],
    ]);
  });

  it("puts each box holding archived files under Archived in storage, below", async () => {
    given();
    render(await home());
    expect(links(card("Archived in storage"))).toEqual([["Box S-003 · Shoes1 file · 1 item", "/paperwork/boxes/s3"]]);
  });

  it("has no Archived in storage heading when nothing is archived", async () => {
    given(["use_modules"], { files: FILES });
    render(await home());
    expect(screen.queryByRole("region", { name: "Archived in storage" })).toBeNull();
  });

  it("shows a banner for unfiled paperwork that opens the unfiled list", async () => {
    given();
    render(await home());
    const banner = screen.getByRole("link", { name: /1 unfiled on your desk/ });
    expect(banner.getAttribute("href")).toBe("/paperwork/unfiled");
    cleanup();
    given(["use_modules"], { papers: PAPERS.filter((row) => row.file_id) });
    render(await home());
    expect(screen.queryByRole("link", { name: /unfiled on your desk/ })).toBeNull();
  });
});

describe("screen 2: files in a place (REQ-100)", () => {
  it("shows every file there as ID · category, label name or No label, and item count", async () => {
    given();
    render(await place("Hall cupboard"));
    expect(screen.getByRole("heading", { level: 2, name: "Hall cupboard" })).toBeDefined();
    expect(links(screen.getByRole("main")).filter(([, href]) => href?.startsWith("/paperwork/files/"))).toEqual([
      ["F-0042 · TaxesReturns2 items", "/paperwork/files/f-42"],
      ["F-0043 · CarNo label0 items", "/paperwork/files/f-43"],
    ]);
  });

  it("does the same for a storage box, with the box in the breadcrumb", async () => {
    given();
    render(await BoxPage({ params: Promise.resolve({ id: "s3" }), searchParams: q() }));
    expect(crumbs()).toEqual(["Paperwork", "Box S-003 · Shoes"]);
    expect(screen.getByRole("link", { name: /F-0009 · Taxes/ }).textContent).toBe("F-0009 · TaxesOld returns1 item");
  });

  it("is not found for a place with no files", async () => {
    given();
    await expect(place("Garage")).rejects.toThrow("NOT_FOUND");
  });
});

describe("screen 3: a file (REQ-100)", () => {
  it("heads with ID · category, label name, location and status, then lists every paper", async () => {
    given();
    render(await openFile("f-42"));
    expect(screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" })).toBeDefined();
    const facts = screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" }).nextElementSibling?.textContent;
    expect(facts).toBe("Returns·Hall cupboard·Active");
    const rows = within(screen.getByRole("list", { name: "Paperwork in this file" })).getAllByRole("link");
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
    expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Edit category, label or location",
      "Show label to reprint",
      "Archive to a storage box",
      "Remove file",
    ]);
  });

  it("edits the file, shows its label, archives it (boxes only) or removes it, each in a sheet", async () => {
    given();
    render(await openFile("f-42"));
    const pick = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Manage file" }));
      fireEvent.click(screen.getByRole("button", { name }));
    };
    pick("Edit category, label or location");
    expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("Hall cupboard");
    pick("Show label to reprint");
    expect(screen.getByLabelText("Label: F-0042 · Taxes")).toBeDefined();
    pick("Archive to a storage box");
    const box = screen.getByLabelText("Box");
    expect(within(box).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a box", "S-003 · Shoes"]);
    pick("Remove file");
    expect(screen.getByRole("button", { name: "Yes, remove the file" })).toBeDefined();
  });

  it("offers Bring back from storage for an archived file", async () => {
    given();
    render(await openFile("f-9"));
    fireEvent.click(screen.getByRole("button", { name: "Manage file" }));
    fireEvent.click(screen.getByRole("button", { name: "Bring back from storage" }));
    expect(screen.getByLabelText("New location")).toBeDefined();
  });

  it("adds paperwork straight into the file: the form has no file to choose", async () => {
    given();
    render(await openFile("f-42"));
    fireEvent.click(screen.getByRole("button", { name: "Add paperwork" }));
    const sheet = screen.getByRole("dialog", { name: "Add paperwork" });
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
    const options = within(move).getAllByRole("option").map((option) => option.textContent);
    expect(options).toContain("Unfiled");
    expect(options).toContain("F-0007 · Car");
    expect(options.some((option) => option?.startsWith("F-0042"))).toBe(false);
  });
});

describe("screen 4: search (REQ-100)", () => {
  it("replaces the screen with results in Files and Paperwork", async () => {
    given();
    render(await place("Hall cupboard", "return"));
    expect(screen.queryByRole("heading", { level: 2, name: "Hall cupboard" })).toBeNull();
    expect(crumbs()).toEqual(["Paperwork", "Results for “return”"]);
    expect(screen.getByRole("heading", { name: "Files · 2" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Paperwork · 3" })).toBeDefined();
  });

  it("matches file ID, label name and category", async () => {
    given();
    for (const [query, want] of [["F-0042", "F-0042 · Taxes"], ["returns", "F-0042 · Taxes"], ["car", "F-0043 · Car"]]) {
      render(await home(query));
      expect(screen.getByRole("region", { name: /^Files/ }).textContent, query).toContain(want);
      cleanup();
    }
  });

  it("shows each paper's file and where it is, Unfiled / Your desk when it has none", async () => {
    given();
    render(await home("e"));
    const rows = within(screen.getByRole("region", { name: /^Paperwork/ })).getAllByRole("link");
    const text = (name: string) => rows.find((row) => row.textContent?.startsWith(name))?.textContent;
    expect(text("2024 federal return")).toBe("2024 federal returnF-0042 · TaxesHall cupboard");
    expect(text("2012 federal return")).toBe("2012 federal returnF-0009 · TaxesBox S-003 · Shoes");
    expect(text("Water bill notice")).toBe("Water bill noticeUnfiledYour desk");
  });

  it("clears back to the screen it was typed on", async () => {
    given();
    render(await place("Hall cupboard", "return"));
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe("/paperwork/locations/Hall%20cupboard");
    expect(screen.getByRole("search").getAttribute("action")).toBe("/paperwork/locations/Hall%20cupboard");
  });
});

describe("screen 5: unfiled (REQ-100)", () => {
  it("lists each unfiled paper's name, owner and logged date, with File it", async () => {
    given();
    render(await UnfiledPage({ searchParams: q() }));
    const row = within(screen.getByRole("list", { name: "Unfiled paperwork" })).getAllByRole("listitem").at(-1)!;
    for (const text of ["Water bill notice", "Sam", "Logged 2026-09-20"]) expect(within(row).getByText(text)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "File Water bill notice" }));
    expect(screen.getByRole("dialog", { name: "File Water bill notice" })).toBeDefined();
  });
});

describe("flows (REQ-100)", () => {
  it("logs paperwork in a sheet over the screen, which closes once it's saved", async () => {
    const fake = given();
    render(await openFile("f-42"));
    fireEvent.click(screen.getByRole("button", { name: "Log paperwork" }));
    const sheet = screen.getByRole("dialog", { name: "Log paperwork" });
    for (const label of ["Name", "Owner", "Document date (optional)", "Notes (optional)", "File", "Keep until (optional)"]) {
      expect(within(sheet).getByLabelText(label), label).toBeDefined();
    }
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Car insurance renewal" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Log paperwork" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log paperwork" })).toBeNull());
    expect(fake.from).toHaveBeenCalledWith("paperwork");
    // Still on the file.
    expect(screen.getByRole("heading", { level: 2, name: "F-0042 · Taxes" })).toBeDefined();
  });

  it("shows a new file's label once, and closing it leaves you where you were", async () => {
    given();
    render(await home());
    fireEvent.click(screen.getByRole("button", { name: "Log paperwork" }));
    const sheet = screen.getByRole("dialog", { name: "Log paperwork" });
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Car title" } });
    fireEvent.change(within(sheet).getByLabelText("File"), { target: { value: "new" } });
    fireEvent.change(within(sheet).getByLabelText("Category"), { target: { value: CAR.id } });
    fireEvent.change(within(sheet).getByLabelText("Location"), { target: { value: "Glovebox" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Log paperwork" }));
    });
    const notice = await screen.findByRole("dialog", { name: "New file: print its label" });
    // The stand-in database hands back its first file row as the new one.
    expect(within(notice).getByLabelText(/^Label: F-/)).toBeDefined();
    fireEvent.click(within(notice).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "New file: print its label" })).toBeNull();
    expect(screen.getByRole("region", { name: "Where your files are" })).toBeDefined();
  });
});

describe("keep-until pre-fills from the file's category (REQ-97)", () => {
  const files = FILES.map((row) => ({ ...row, status: "active" as const }));
  const renderForm = () =>
    render(<PaperForm people={PEOPLE} files={files} categories={[CAR, TAXES]} locations={[]} today="2026-09-24" />);
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

describe("categories (REQ-88)", () => {
  it("are locked for a member", async () => {
    given();
    render(await CategoriesPage({}));
    expect(card("Categories").textContent).toContain("Admin only");
    expect(screen.queryByRole("button", { name: "Add the category" })).toBeNull();
  });

  it("are the admin's to add, edit and remove, with how long each keeps and how many files use it", async () => {
    given(ADMIN);
    render(await CategoriesPage({}));
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

