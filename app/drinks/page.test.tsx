// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import DrinkPage from "./[id]/page";
import NewDrinkPage from "./new/page";
import DrinksPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/drinks",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

// An invented cellar and household; nothing here is real. user-1 is the
// person signed in.
const drink = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  producer: null,
  type: null,
  vintage: null,
  non_vintage: false,
  grapes: [],
  region: null,
  country: null,
  abv: null,
  bottle_ml: null,
  sweetness: null,
  method: null,
  disgorged_on: null,
  created_at: "2026-09-01T12:00:00Z",
  ...extra,
});
const DRINKS = [
  drink("d3", "Crémant Brut", { producer: "Maison Pretend", type: "sparkling", non_vintage: true, created_at: "2026-09-20T12:00:00Z" }),
  drink("d2", "Old Vine", { producer: "Made-up Estate", type: "red", vintage: 2021, grapes: ["Shiraz"], created_at: "2026-09-10T12:00:00Z" }),
  drink("d1", "Reserva", { producer: "Bodega Ficticia", type: "red", vintage: 2019, abv: 14, bottle_ml: 750 }),
];
const RATINGS = [
  { drink_id: "d1", user_id: "user-1", stars: 4, comment: "great with lamb", updated_at: "2026-09-21T15:00:00Z" },
  { drink_id: "d2", user_id: "user-2", stars: 5, comment: null, updated_at: "2026-09-22T15:00:00Z" },
];
const PEOPLE = [
  { user_id: "user-1", name: "Sam", manages_budget: true },
  { user_id: "user-2", name: "Alex", manages_budget: false },
];

function given(drinks: unknown[] = DRINKS) {
  const fake = fakeSupabase({ permissions: ["use_modules"], people: PEOPLE, tables: { drinks, drink_ratings: RATINGS } });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const list = (params: { q?: string; type?: string; sort?: string } = {}) => DrinksPage({ searchParams: Promise.resolve(params) });
const open = (id: string) => DrinkPage({ params: Promise.resolve({ id }) });
const cards = () =>
  within(screen.getByRole("region", { name: /Our drinks|Results/ }))
    .queryAllByRole("link")
    .map((link) => link.textContent);

describe("the Drinks list (REQ-30)", () => {
  it("shows each drink's type, name, producer, vintage and every member's rating or not rated", async () => {
    given();
    render(await list());
    const [cremant, oldVine, reserva] = within(screen.getByRole("region", { name: /Our drinks/ })).getAllByRole("link");
    expect(cremant.textContent).toContain("Sparkling · Maison Pretend · NV");
    expect(reserva.textContent).toContain("Red · Bodega Ficticia · 2019");
    const ratings = (card: HTMLElement) =>
      within(within(card).getByRole("list", { name: "Ratings" }))
        .getAllByRole("listitem")
        .map((row) => row.textContent);
    expect(ratings(reserva)).toEqual(["Sam ★★★★☆", "Alex not rated"]);
    expect(ratings(oldVine)).toEqual(["Sam not rated", "Alex ★★★★★"]);
    expect(reserva.getAttribute("href")).toBe("/drinks/d1");
  });

  it("searches, and keeps the filter and sort in the same form", async () => {
    given();
    render(await list({ q: "lamb" }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toContain("Reserva");
    const search = screen.getByRole("search");
    expect(screen.getByRole("combobox", { name: "Type" }).getAttribute("form")).toBe(search.id);
    expect(screen.getByRole("combobox", { name: "Sort" }).getAttribute("form")).toBe(search.id);
  });

  it("filters to one type and sorts by a chosen member's rating", async () => {
    given();
    render(await list({ type: "sparkling" }));
    expect(cards()).toHaveLength(1);
    cleanup();
    render(await list({ sort: "rating:user-2" }));
    expect(cards().map((text) => text?.split("Red")[0].split("Sparkling")[0])).toEqual(["Old Vine", "Crémant Brut", "Reserva"]);
    const sort = screen.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement;
    expect([...sort.options].map((option) => option.textContent)).toEqual([
      "Newest first",
      "Oldest first",
      "Sam's rating",
      "Alex's rating",
    ]);
    expect(sort.value).toBe("rating:user-2");
  });

  it("says so when there's nothing yet, and offers Add a drink", async () => {
    given([]);
    render(await list());
    expect(screen.getByText("Nothing recorded yet. Add a drink to start.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add a drink" }).getAttribute("href")).toBe("/drinks/new");
  });

  // One-handed: every control is at least the 44px tap target, the list
  // is one column on a phone, and nothing needs a hover.
  it("keeps the search, filter and sort in plain full-size controls", async () => {
    given();
    render(await list());
    expect(screen.getByRole("searchbox", { name: "Search drinks" })).toBeTruthy();
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });
});

describe("adding a drink by hand (REQ-37)", () => {
  it("offers every field empty, with only the name required", async () => {
    given();
    render(await NewDrinkPage());
    const form = screen.getByRole("region", { name: "Add a drink" });
    const inputs = [...form.querySelectorAll("input:not([type=hidden]), select")] as HTMLInputElement[];
    expect(inputs.filter((input) => input.required).map((input) => input.name)).toEqual(["name"]);
    expect(inputs.every((input) => input.value === "")).toBe(true);
    expect(inputs.map((input) => input.name)).toEqual(
      expect.arrayContaining(["name", "producer", "type", "vintage", "grape", "region", "country", "abv", "bottle_ml"]),
    );
  });

  it("offers grape, region and country suggestions from the standard lists, and type from its list", async () => {
    given();
    render(await NewDrinkPage());
    const form = screen.getByRole("region", { name: "Add a drink" });
    const listed = (name: string) => {
      const input = form.querySelector(`input[name=${name}]`) as HTMLInputElement;
      const id = input.getAttribute("list")!;
      return [...form.querySelectorAll(`datalist#${id} option`)].map((option) => option.getAttribute("value"));
    };
    expect(listed("grape")).toEqual(expect.arrayContaining(["Syrah", "Shiraz", "Tempranillo"]));
    expect(listed("region")).toEqual(expect.arrayContaining(["Rioja", "Barossa Valley"]));
    expect(listed("country")).toEqual(expect.arrayContaining(["Spain", "Australia"]));
    const type = within(form).getByRole("combobox", { name: "Type (optional)" }) as HTMLSelectElement;
    expect([...type.options].map((option) => option.textContent)).toEqual([
      "Not set",
      "Red",
      "White",
      "Rosé",
      "Sparkling",
      "Dessert",
      "Fortified",
      "Orange",
    ]);
  });

  it("asks sparkling wines for sweetness, method and disgorgement too", async () => {
    given();
    render(await NewDrinkPage());
    expect(screen.queryByRole("combobox", { name: "Sweetness (optional)" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Type (optional)" }), { target: { value: "sparkling" } });
    expect(screen.getByRole("combobox", { name: "Sweetness (optional)" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Method (optional)" })).toBeTruthy();
  });

  it("takes several grapes", async () => {
    given();
    render(await NewDrinkPage());
    fireEvent.click(screen.getByRole("button", { name: "Add another grape" }));
    expect(screen.getAllByRole("combobox", { name: /Grape \d/ })).toHaveLength(2);
  });
});

describe("a drink's page (REQ-29)", () => {
  it("shows every member's rating and comment by name, when it last changed, and Not rated yet", async () => {
    given();
    render(await open("d1"));
    const rows = within(screen.getByRole("region", { name: "Ratings" }))
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(rows).toEqual(["Sam★★★★☆great with lambChanged 21 Sept 2026", "AlexNot rated yet"]);
  });

  it("lets you rate any time, with your own rating filled in when you rate again", async () => {
    given();
    render(await open("d1"));
    fireEvent.click(screen.getByRole("button", { name: "Change my rating" }));
    const sheet = screen.getByRole("dialog", { name: "Change my rating" });
    expect((within(sheet).getByRole("radio", { name: "4 stars" }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByRole("textbox", { name: /Comment/ }) as HTMLInputElement).value).toBe("great with lamb");
    expect(within(sheet).getAllByRole("radio")).toHaveLength(5);
    expect(within(sheet).getByRole("button", { name: "Clear my rating" })).toBeTruthy();
  });

  it("offers Rate on a drink you haven't rated, empty", async () => {
    given();
    render(await open("d2"));
    fireEvent.click(screen.getByRole("button", { name: "Rate" }));
    const sheet = screen.getByRole("dialog", { name: "Rate it" });
    expect(within(sheet).getAllByRole("radio").some((radio) => (radio as HTMLInputElement).checked)).toBe(false);
    expect(within(sheet).queryByRole("button", { name: "Clear my rating" })).toBeNull();
  });

  it("shows the details it has, and none it doesn't", async () => {
    given();
    render(await open("d1"));
    const details = screen.getByRole("region", { name: "Details" }).textContent;
    expect(details).toContain("ProducerBodega Ficticia");
    expect(details).toContain("Alcohol14%");
    expect(details).toContain("BottleStandard (750 ml)");
    expect(details).not.toContain("Region");
  });

  it("is not found for a drink that doesn't exist", async () => {
    given();
    await expect(open("nope")).rejects.toThrow("NOT_FOUND");
  });
});
