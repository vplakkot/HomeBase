// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import ArchivedPetsPage from "./archived/page";
import PetPage from "./[id]/page";
import PetsPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pets",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// An invented household of pets; nothing here is real.
const pet = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  nickname: null,
  species: "Dog",
  photo_path: null,
  archived_at: null,
  created_at: `2026-09-0${id.slice(1)}T00:00:00Z`,
  ...extra,
});
const PETS = [
  pet("p1", "Biscuit", { nickname: "Bisc" }),
  pet("p2", "Mochi", { species: "Cat", photo_path: "p2/1.jpg" }),
  pet("p3", "Old Boy", { archived_at: "2026-09-30T00:00:00Z" }),
];

const vaccine = (id: string, name: string, given_on: string, next_due_on: string, petId = "p1") => ({
  id,
  pet_id: petId,
  name,
  given_on,
  next_due_on,
  clinic: null,
  notes: null,
  created_at: `${given_on}T09:00:00Z`,
});
const VACCINES = [
  vaccine("v1", "Rabies", "2024-10-01", "2025-10-01"),
  vaccine("v2", "Rabies", "2025-10-02", "2026-10-02"),
  vaccine("v3", "Bordetella", "2026-04-01", "2026-10-20"),
  vaccine("v4", "Distemper", "2026-09-01", "2027-09-01"),
  vaccine("v5", "Rabies", "2026-01-01", "2029-01-01", "p2"),
];

const diet = (id: string, petId: string, extra: Record<string, unknown> = {}) => ({
  id,
  pet_id: petId,
  kind: "commercial",
  brand: "Acme",
  product: "Salmon",
  purpose: "GI",
  protein: null,
  batch_prep_on: null,
  grams_per_meal: 120,
  meals_per_day: 2,
  notes: null,
  started_on: "2026-09-01",
  ended_on: null,
  ...extra,
});
const DIETS = [
  diet("d1", "p1"),
  diet("d0", "p1", { brand: "Old", product: "Kibble", grams_per_meal: 100, started_on: "2026-01-01", ended_on: "2026-08-31" }),
  diet("d2", "p2", { kind: "home_cooked", brand: null, product: null, protein: "chicken", grams_per_meal: 85.5, batch_prep_on: "2026-10-05" }),
];

const med = (extra: Record<string, unknown> = {}) => ({
  id: "m1",
  name: "Chewable",
  purpose: "Flea, tick and heartworm",
  dose: "1 tablet",
  frequency: "monthly",
  every_n_days: null,
  starts_on: "2026-01-01",
  ends_on: null,
  prescribing_vet: null,
  doses_on_hand: 3,
  doses_per_delivery: 6,
  delivery_interval_months: 3,
  last_delivery_on: "2026-09-20",
  lead_time_days: 10,
  ...extra,
});

function given(permissions = ["use_modules"], tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    permissions,
    people: [{ user_id: "user-1", name: "Sam", manages_budget: true }],
    tables: {
      pets: PETS,
      pet_vaccines: VACCINES,
      pet_diets: DIETS,
      pet_medications: [med()],
      pet_medication_pets: [
        { medication_id: "m1", pet_id: "p1", next_dose_on: "2026-10-20" },
        { medication_id: "m1", pet_id: "p2", next_dose_on: "2026-10-21" },
      ],
      pet_doses: [{ id: "x1", medication_id: "m1", pet_id: "p1", given_on: "2026-09-20", given_by: "user-1", previous_next_dose_on: "2026-09-20", created_at: "2026-09-20T10:00:00Z" }],
      ...tables,
    },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  return fake;
}

// The pets' cards: links to a profile, not the section tabs.
const petLinks = () =>
  within(screen.getByRole("main"))
    .getAllByRole("link")
    .filter((link) => /^\/pets\/(?!archived$)[^/]+$/.test(link.getAttribute("href") ?? ""));
const open = (id: string) => PetPage({ params: Promise.resolve({ id }) });
const section = (name: string) => screen.getByRole("region", { name });

describe("the Pets home (REQ-186)", () => {
  it("shows one card per active pet, each a link to its profile", async () => {
    given();
    render(await PetsPage());
    const links = petLinks();
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/pets/p1", "/pets/p2"]);
    expect(links[0].textContent).toContain("Biscuit “Bisc”");
    expect(links[0].textContent).toContain("Dog");
    expect(links[1].textContent).toContain("Mochi");
  });

  it("shows the current food and grams per meal on each card (REQ-188)", async () => {
    given();
    render(await PetsPage());
    const links = petLinks();
    expect(links[0].textContent).toContain("Acme Salmon · 120 g a meal");
    expect(links[1].textContent).toContain("Home-cooked chicken · 85.5 g a meal");
  });

  it("shows a pet's photo from a short-lived link to the private bucket, and the first letter without one", async () => {
    given();
    render(await PetsPage());
    expect(screen.getByRole("img", { name: "Mochi" }).getAttribute("src")).toBe("https://signed.example/p2/1-thumb.jpg");
    expect(screen.getByText("B")).toBeDefined();
  });

  it("hides archived pets", async () => {
    given();
    render(await PetsPage());
    expect(screen.queryByText(/Old Boy/)).toBeNull();
  });

  it("says so when there are none", async () => {
    given(["use_modules"], { pets: [] });
    render(await PetsPage());
    expect(screen.getByText("No pets yet. Add pet to start a profile.")).toBeDefined();
  });

  it("has Add pet in the header for members, with name, nickname, species and photo", async () => {
    given();
    render(await PetsPage());
    const add = within(screen.getByRole("banner")).getByRole("button", { name: "Add pet" });
    fireEvent.click(add);
    const sheet = screen.getByRole("dialog", { name: "Add a pet" });
    for (const label of ["Name", "Nickname (optional)", "Species", "Photo"]) {
      expect(within(sheet).getByLabelText(label)).toBeDefined();
    }
  });

  it("has no Add pet for someone who can't use modules, but they see every pet", async () => {
    given([]);
    render(await PetsPage());
    expect(screen.queryByRole("button", { name: "Add pet" })).toBeNull();
    expect(petLinks()).toHaveLength(2);
  });
});

describe("archived pets (REQ-186)", () => {
  it("lists the archived profiles, each opening read-only", async () => {
    given();
    render(await ArchivedPetsPage());
    expect(petLinks().map((link) => link.getAttribute("href"))).toEqual(["/pets/p3"]);
  });

  it("opens one with its records kept, no way to edit them, and Restore", async () => {
    given(["use_modules"], { pet_vaccines: [vaccine("v9", "Rabies", "2026-05-01", "2027-05-01", "p3")] });
    render(await open("p3"));
    expect(screen.getByText("Rabies")).toBeDefined();
    expect(screen.getByRole("button", { name: "Restore" })).toBeDefined();
    for (const name of ["Edit", "Archive", "Log vaccine", "Set diet", "Add medication", "Log new dose"]) {
      expect(screen.queryByRole("button", { name }), name).toBeNull();
    }
  });
});

describe("a pet's profile (REQ-186)", () => {
  it("shows the name with its nickname and species, and Edit and Archive for members", async () => {
    given();
    render(await open("p1"));
    expect(screen.getByRole("heading", { name: "Biscuit “Bisc”" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Edit" })[0]).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("dialog", { name: "Archive Biscuit" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Yes, archive" })).toBeDefined();
  });

  it("gives anyone who can use modules the same view and edit", async () => {
    given(["use_modules"]);
    render(await open("p2"));
    expect(screen.getByRole("button", { name: "Log vaccine" })).toBeDefined();
  });

  it("is not found for a pet that doesn't exist", async () => {
    given();
    await expect(open("nope")).rejects.toThrow("NOT_FOUND");
  });
});

describe("vaccines on the profile (REQ-187)", () => {
  it("shows the latest entry per vaccine with its status, most urgent first", async () => {
    given();
    render(await open("p1"));
    const vaccines = section("Vaccines");
    const rows = within(vaccines).getAllByRole("listitem").filter((item) => item.querySelector("h3"));
    expect(rows.map((row) => row.querySelector("h3")!.textContent)).toEqual(["Rabies", "Bordetella", "Distemper"]);
    // Rabies' latest is the one given 2025-10-02, due 2026-10-02: overdue.
    expect(rows[0].textContent).toContain("Overdue");
    expect(rows[0].textContent).toContain("2 Oct 2026");
    expect(rows[1].textContent).toContain("Due soon");
    expect(rows[1].textContent).toContain("20 Oct 2026");
    expect(rows[2].textContent).toContain("Current");
  });

  it("keeps earlier doses in the history, newest first, and not another pet's", async () => {
    given();
    render(await open("p1"));
    const rabies = within(section("Vaccines")).getByText(/History \(2\)/).closest("details")!;
    const entries = within(rabies).getAllByRole("listitem").map((item) => item.textContent);
    expect(entries[0]).toContain("2 Oct 2025");
    expect(entries[1]).toContain("1 Oct 2024");
    expect(within(section("Vaccines")).queryByText(/2029/)).toBeNull();
  });

  it("logs a vaccine with name, date given, next due date, clinic and notes", async () => {
    given();
    render(await open("p1"));
    fireEvent.click(within(section("Vaccines")).getByRole("button", { name: "Log vaccine" }));
    const sheet = screen.getByRole("dialog", { name: "Log a vaccine" });
    for (const label of ["Vaccine", "Date given", "Next due", "Vet or clinic (optional)", "Notes (optional)"]) {
      expect(within(sheet).getByLabelText(label)).toBeDefined();
    }
  });

  it("says so when none are logged", async () => {
    given(["use_modules"], { pet_vaccines: [] });
    render(await open("p1"));
    expect(screen.getByText("No vaccines logged.")).toBeDefined();
  });
});

describe("diet on the profile (REQ-188)", () => {
  it("shows the current diet and the past ones with their start and end dates, newest first", async () => {
    given();
    render(await open("p1"));
    const diets = section("Diet");
    expect(diets.textContent).toContain("Acme Salmon");
    expect(diets.textContent).toContain("120 g");
    expect(diets.textContent).toContain("2 meals a day");
    expect(diets.textContent).toContain("since 1 Sep 2026");
    const past = within(diets).getByText(/Past diets \(1\)/).closest("details")!;
    expect(past.textContent).toContain("Old Kibble");
    expect(past.textContent).toContain("1 Jan 2026 to 31 Aug 2026");
  });

  it("shows a home-cooked diet's protein and batch prep date", async () => {
    given();
    render(await open("p2"));
    const diets = section("Diet");
    expect(diets.textContent).toContain("Home-cooked chicken");
    expect(diets.textContent).toContain("Batch prepped 5 Oct 2026");
  });

  it("offers Change diet, whose form follows the type", async () => {
    given();
    render(await open("p1"));
    fireEvent.click(within(section("Diet")).getByRole("button", { name: "Change diet" }));
    const sheet = screen.getByRole("dialog", { name: "Change the diet" });
    for (const label of ["Brand", "Product", "Purpose (optional, for example GI)", "Grams per meal", "Meals per day"]) {
      expect(within(sheet).getByLabelText(label), label).toBeDefined();
    }
    fireEvent.change(within(sheet).getByLabelText("Type"), { target: { value: "home_cooked" } });
    for (const label of ["Protein", "Batch prep date (optional)", "Recipe notes (optional)"]) {
      expect(within(sheet).getByLabelText(label), label).toBeDefined();
    }
    expect(within(sheet).queryByLabelText("Brand")).toBeNull();
  });

  it("offers Set diet when there is none", async () => {
    given(["use_modules"], { pet_diets: [] });
    render(await open("p1"));
    expect(screen.getByText("No diet set.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Set diet" })).toBeDefined();
  });
});

describe("medications on the profile (REQ-189)", () => {
  it("shows next dose, doses on hand and order-by date", async () => {
    given();
    render(await open("p1"));
    const meds = section("Medications");
    expect(meds.textContent).toContain("Chewable");
    expect(meds.textContent).toContain("Next dose 20 Oct 2026");
    expect(meds.textContent).toContain("Doses on hand 3");
    // Monthly: 1 each for 2 pets, 3 on hand: 45 days from 8 Oct is 22 Nov, less 10 days.
    expect(meds.textContent).toContain("Order by 12 Nov 2026");
  });

  it("shows the other pets that take the same product", async () => {
    given();
    render(await open("p1"));
    expect(section("Medications").textContent).toContain("Also: Mochi");
  });

  it("warns of a supply gap with the order-by date when it runs out before the next delivery", async () => {
    given();
    render(await open("p1"));
    // Runs out 22 Nov; the next delivery is 20 Dec.
    const warning = within(section("Medications")).getByRole("status");
    expect(warning.textContent).toContain("runs out 22 Nov 2026");
    expect(warning.textContent).toContain("next delivery on 20 Dec 2026");
    expect(warning.textContent).toContain("Order by 12 Nov 2026");
  });

  it("shows no warning when the supply lasts past the next delivery", async () => {
    given(["use_modules"], { pet_medications: [med({ doses_on_hand: 12 })] });
    render(await open("p1"));
    expect(within(section("Medications")).queryByRole("status")).toBeNull();
  });

  it("has Mark given, Mark delivery received, Undo, Edit and Remove", async () => {
    given();
    render(await open("p1"));
    const meds = section("Medications");
    for (const name of ["Mark given", "Mark delivery received", "Undo last dose", "Edit", "Remove"]) {
      expect(within(meds).getByRole("button", { name }), name).toBeDefined();
    }
    expect(meds.textContent).toContain("Last given 20 Sep 2026 by Sam");
  });

  it("links one product to several pets in its form", async () => {
    given();
    render(await open("p1"));
    fireEvent.click(within(section("Medications")).getByRole("button", { name: "Add medication" }));
    const sheet = screen.getByRole("dialog", { name: "Add a medication" });
    const taken = within(sheet).getByRole("group", { name: "Taken by" });
    expect(within(taken).getAllByRole("checkbox").map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(within(taken).getByLabelText("Mochi")).toBeDefined();
    for (const label of [
      "Name",
      "Purpose (for example, flea, tick and heartworm)",
      "Dose",
      "How often",
      "Starts",
      "Prescribing vet (optional)",
      "Doses on hand",
      "Doses per delivery",
      "Delivery every (months)",
      "Last delivery",
      "Order lead time (days)",
    ]) {
      expect(within(sheet).getByLabelText(label), label).toBeDefined();
    }
  });

  it("shows an ended course as ended, with no Mark given", async () => {
    given(["use_modules"], { pet_medication_pets: [{ medication_id: "m1", pet_id: "p1", next_dose_on: null }] });
    render(await open("p1"));
    const meds = section("Medications");
    expect(meds.textContent).toContain("Course ended");
    expect(within(meds).queryByRole("button", { name: "Mark given" })).toBeNull();
  });
});
