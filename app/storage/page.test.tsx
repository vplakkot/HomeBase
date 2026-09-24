// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import AddPage from "./add/page";
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
      paperwork_files: [ARCHIVED],
      paperwork: [],
    },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const card = (name: string) => screen.getByRole("region", { name });
const texts = (region: HTMLElement) => within(region).getAllByRole("listitem").map((item) => item.textContent);
const list = (q = "") => StoragePage({ searchParams: Promise.resolve({ q }) });
const open = (id: string, made?: string) =>
  EntryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(made ? { new: made } : {}) });

describe("the Storage list (REQ-87)", () => {
  it("shows each entry's ID, name, box or not, and a short preview of its contents", async () => {
    given();
    render(await list());
    expect(texts(card("Search"))).toEqual([
      "S-001 · SuitcasesNot a box",
      "S-003 · ShoesBoxSki boots, Hiking boots, Sandals, and 1 more",
      "S-004 · Seasonal clothesBox",
    ]);
    expect(within(card("Search")).getByRole("link", { name: /S-003/ }).getAttribute("href")).toBe("/storage/entries/s3");
  });

  it("finds the box ski boots are in", async () => {
    given();
    render(await list("ski boots"));
    expect(texts(card("Search"))).toEqual(["S-003 · ShoesBoxSki boots, Hiking boots, Sandals, and 1 more"]);
  });

  it("says when nothing matches", async () => {
    given();
    render(await list("canoe"));
    expect(card("Search").textContent).toContain("Nothing matches.");
  });
});

describe("adding an entry (REQ-87)", () => {
  it("asks for a name, box or not and a note; contents only once it's a box", async () => {
    given();
    render(await AddPage());
    expect(screen.getByLabelText("Name")).toBeDefined();
    expect(screen.getByLabelText("Note (optional)")).toBeDefined();
    expect(screen.queryByLabelText(/Contents/)).toBeNull();
    fireEvent.click(screen.getByLabelText("It's a box"));
    expect(screen.getByLabelText("Contents (optional, one item per line)").tagName).toBe("TEXTAREA");
  });
});

describe("an entry's page (REQ-87, REQ-98)", () => {
  it("shows a new entry's ID for the label printer", async () => {
    given();
    render(await open("s3", "1"));
    expect(screen.getByLabelText("ID: S-003").textContent).toBe("S-003");
    expect(screen.getByRole("heading", { name: "New: label the box" })).toBeDefined();
  });

  it("lists every item in the box and the paperwork files archived in it, by ID", async () => {
    given();
    render(await open("s3"));
    const inside = card("In this box");
    expect(within(inside).getByRole("list", { name: "Contents" }).textContent).toBe(
      "Ski bootsHiking bootsSandalsWellies",
    );
    const file = within(inside).getByRole("link", { name: /F-0009 · Taxes/ });
    expect(file.getAttribute("href")).toBe("/paperwork/files/f-9");
  });

  it("shows the note", async () => {
    given();
    render(await open("s4"));
    expect(card("Seasonal clothes").textContent).toContain("winter clothes in summer");
  });

  it("has no contents for something that isn't a box", async () => {
    given();
    render(await open("s1"));
    expect(screen.queryByRole("region", { name: "In this box" })).toBeNull();
  });

  it("fills the change form with every field, ID not among them", async () => {
    given();
    render(await open("s3"));
    const change = card("Change the entry");
    expect((within(change).getByLabelText("Name") as HTMLInputElement).value).toBe("Shoes");
    expect((within(change).getByLabelText("It's a box") as HTMLInputElement).checked).toBe(true);
    expect((within(change).getByLabelText(/Contents/) as HTMLTextAreaElement).value).toContain("Wellies");
  });

  it("asks before removing", async () => {
    given();
    render(await open("s1"));
    const change = card("Change the entry");
    fireEvent.click(within(change).getByRole("button", { name: "Remove S-001" }));
    expect(change.textContent).toContain("Remove S-001 Suitcases?");
    expect(within(change).getByRole("button", { name: "Yes, remove it" })).toBeDefined();
    fireEvent.click(within(change).getByRole("button", { name: "Keep it" }));
    expect(within(change).queryByRole("button", { name: "Yes, remove it" })).toBeNull();
  });

  it("is not found for an entry that doesn't exist", async () => {
    given();
    await expect(open("nope")).rejects.toThrow("NOT_FOUND");
  });
});
