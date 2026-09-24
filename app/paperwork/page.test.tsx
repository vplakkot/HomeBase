// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import CategoriesPage from "./categories/page";
import FilePage from "./files/[id]/page";
import { PaperForm } from "./forms";
import PaperPage from "./items/[id]/page";
import LogPage from "./log/page";
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
const CAR = { id: "c-car", name: "Car", keep_years: null };
const file = (id: string, number: number, category_id: string, label: string | null, location: string) => ({
  id,
  number,
  category_id,
  location,
  label,
  status: "active",
});
const FILES = [
  file("f-42", 42, "c-tax", "Returns", "Hall cupboard"),
  file("f-7", 7, "c-car", null, "Glovebox"),
];
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
];

function given(permissions = ["use_modules"]) {
  const fake = fakeSupabase({
    permissions,
    people: PEOPLE,
    tables: { paperwork_categories: [CAR, TAXES], paperwork_files: FILES, paperwork: PAPERS },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const ADMIN = ["use_modules", "manage_members", "manage_paperwork"];
const card = (name: string) => screen.getByRole("region", { name });
const texts = (region: HTMLElement) => within(region).getAllByRole("listitem").map((item) => item.textContent);

describe("the files list (REQ-88)", () => {
  it("shows every file's ID and category, label name, last stored location and paper count", async () => {
    given();
    render(await PaperworkPage({ searchParams: Promise.resolve({}) }));
    expect(texts(card("Search"))).toEqual([
      "F-0007 · Car0 papersLast stored location: Glovebox",
      "F-0042 · Taxes2 papersReturnsLast stored location: Hall cupboard",
    ]);
    expect(within(card("Search")).getAllByRole("link")[1].getAttribute("href")).toBe("/paperwork/files/f-42");
  });

  it("finds a file by ID and paperwork by name", async () => {
    given();
    render(await PaperworkPage({ searchParams: Promise.resolve({ q: "f42" }) }));
    expect(texts(card("Search"))).toHaveLength(1);
    cleanup();
    render(await PaperworkPage({ searchParams: Promise.resolve({ q: "water" }) }));
    expect(texts(card("Paperwork"))).toEqual(["Water bill noticeSam · Unfiled"]);
  });

  it("filters by category", async () => {
    given();
    render(await PaperworkPage({ searchParams: Promise.resolve({ category: "c-car" }) }));
    expect(texts(card("Search"))).toEqual(["F-0007 · Car0 papersLast stored location: Glovebox"]);
  });
});

describe("a file (REQ-88)", () => {
  it("shows its label to print and every paper in it", async () => {
    given();
    render(await FilePage({ params: Promise.resolve({ id: "f-42" }), searchParams: Promise.resolve({ new: "1" }) }));
    expect(screen.getByRole("heading", { name: "New file: print its label" })).toBeDefined();
    expect(screen.getByLabelText("Label: F-0042 · Taxes").textContent).toBe("F-0042 · Taxes");
    expect(texts(card("In this file"))).toEqual(["2024 federal returnAlex", "2023 federal returnJoint"]);
  });

  it("offers its location to change", async () => {
    given();
    render(await FilePage({ params: Promise.resolve({ id: "f-7" }), searchParams: Promise.resolve({}) }));
    const form = card("Change the file");
    expect((within(form).getByLabelText("Location") as HTMLInputElement).value).toBe("Glovebox");
  });
});

describe("unfiled paperwork (REQ-97)", () => {
  it("lists only what has no file, each with a way to file it", async () => {
    given();
    render(await UnfiledPage());
    const unfiled = card("1 unfiled");
    expect(within(unfiled).getByText("Water bill notice")).toBeDefined();
    expect(within(unfiled).getByRole("button", { name: "File Water bill notice" })).toBeDefined();
  });
});

describe("logging and editing paperwork (REQ-97)", () => {
  it("asks for name, owner (a member or Joint), document date, notes, file and keep-until", async () => {
    given();
    render(await LogPage());
    const log = card("Log new paperwork");
    for (const label of ["Name", "Owner", "Document date (optional)", "Notes (optional)", "File", "Keep until (optional)"]) {
      expect(within(log).getByLabelText(label), label).toBeDefined();
    }
    const owners = within(within(log).getByLabelText("Owner")).getAllByRole("option").map((option) => option.textContent);
    expect(owners).toEqual(["Joint", "Alex", "Sam"]);
    expect((within(log).getByLabelText("File") as HTMLSelectElement).value).toBe("");
  });

  it("opens a paper with its fields filled in, its file included", async () => {
    given();
    render(await PaperPage({ params: Promise.resolve({ id: "p1" }) }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("2024 federal return");
    expect((screen.getByLabelText("File") as HTMLSelectElement).value).toBe("f-42");
    expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("u-alex");
  });
});

describe("keep-until pre-fills from the file's category (REQ-97)", () => {
  const files = FILES.map((row) => ({ ...row, status: "active" as const }));
  const renderForm = () =>
    render(<PaperForm people={PEOPLE} files={files} categories={[CAR, TAXES]} today="2026-09-24" />);
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
    render(await CategoriesPage());
    expect(card("Categories").textContent).toContain("Admin only");
    expect(screen.queryByRole("button", { name: "Add the category" })).toBeNull();
  });

  it("are the admin's to add, edit and remove, with how long each keeps and how many files use it", async () => {
    given(ADMIN);
    render(await CategoriesPage());
    expect(screen.getByRole("button", { name: "Add the category" })).toBeDefined();
    const [car, taxes] = within(card("Categories")).getAllByRole("listitem");
    expect(car.textContent).toContain("No default");
    expect(taxes.textContent).toContain("Keep 7 yr");
    expect(taxes.textContent).toContain("1 file");
    // Removing Taxes asks where its file goes first.
    expect(within(taxes).getByLabelText("Move its 1 file to")).toBeDefined();
    expect(within(taxes).getByRole("button", { name: "Move the files and remove Taxes" })).toBeDefined();
  });
});
