// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { placesFromEnv, type Place, type Places } from "../../lib/restaurants/places";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import RestaurantPage from "./[id]/page";
import AddPlacePage from "./new/page";
import RestaurantsPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/restaurants/places", async (original) => ({
  ...(await original<typeof import("../../lib/restaurants/places")>()),
  placesFromEnv: vi.fn(),
}));
vi.mock("./actions", () => ({ lookUpPlace: vi.fn(), addPlace: vi.fn(), removePlace: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/restaurants",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

// Invented places and household; nothing here is real. Rows come back
// newest first, as the database is asked for them.
const ROWS = [
  { id: "r2", google_place_id: "ChIJInventedNoodles01", added_by: "user-2", created_at: "2026-09-27T12:00:00Z" },
  { id: "r1", google_place_id: "ChIJInventedTaqueria1", added_by: "user-1", created_at: "2026-09-20T12:00:00Z" },
];
const PEOPLE = [
  { user_id: "user-1", name: "Sam", manages_budget: true },
  { user_id: "user-2", name: "Alex", manages_budget: false },
];

function place(placeId: string, extra: Partial<Place>): Place {
  return {
    placeId,
    name: "Somewhere",
    address: null,
    location: null,
    cuisine: null,
    neighborhood: null,
    hours: [],
    website: null,
    mapsUrl: null,
    photo: null,
    ...extra,
  };
}

const GOOGLE: Record<string, Place> = {
  ChIJInventedNoodles01: place("ChIJInventedNoodles01", {
    name: "Corner Noodle Bar",
    cuisine: "Noodle",
    neighborhood: "Lower East Side",
    address: "12 Invented St, New York",
    hours: ["Monday: 11 AM – 10 PM", "Tuesday: Closed"],
    website: "https://www.corner-noodles.example/menu",
    photo: { name: "places/ChIJInventedNoodles01/photos/P1", credit: "A. Photographer" },
  }),
  ChIJInventedTaqueria1: place("ChIJInventedTaqueria1", { name: "Taqueria Pretend", cuisine: "Mexican", neighborhood: "Mission" }),
};

let places: Places;

beforeEach(() => {
  places = {
    details: vi.fn(async (id: string) => GOOGLE[id] ?? null),
    search: vi.fn(),
    photoLink: vi.fn(),
  };
  vi.mocked(placesFromEnv).mockReturnValue(places);
});

function given(rows: unknown[] = ROWS) {
  const fake = fakeSupabase({ permissions: ["use_modules"], people: PEOPLE, tables: { restaurants: rows } });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const tiles = () => within(screen.getByRole("region", { name: /Want to try/ })).queryAllByRole("link");

describe("Want to try (REQ-129)", () => {
  it("shows each place as a tile with Google's photo, name, cuisine and neighbourhood, newest first", async () => {
    given();
    render(await RestaurantsPage());
    const [noodles, tacos] = tiles();
    expect(noodles.textContent).toContain("Corner Noodle Bar");
    expect(noodles.textContent).toContain("Noodle · Lower East Side");
    expect(noodles.getAttribute("href")).toBe("/restaurants/r2");
    expect(noodles.querySelector("img")?.getAttribute("src")).toBe(
      "/restaurants/photo?name=places%2FChIJInventedNoodles01%2Fphotos%2FP1&w=400",
    );
    expect(tacos.textContent).toContain("Taqueria Pretend");
    // REQ-90: loaded from Google by ID, not from a copy of our own.
    expect(places.details).toHaveBeenCalledWith("ChIJInventedNoodles01", "tile");
  });

  it("draws a plain block in the module colour where Google has no photo", async () => {
    given();
    render(await RestaurantsPage());
    const tacos = tiles()[1];
    expect(tacos.querySelector("img")).toBeNull();
    expect(tacos.querySelector('[aria-hidden="true"]')?.className).toMatch(/noPhoto/);
  });

  it("still lists a place Google can't answer for, so it can be opened and removed", async () => {
    given();
    vi.mocked(places.details).mockRejectedValue(new Error("Google down"));
    render(await RestaurantsPage());
    expect(tiles().map((tile) => tile.textContent)).toEqual(["Couldn't load from Google", "Couldn't load from Google"]);
  });

  it("with no places, says so and offers Add place", async () => {
    given([]);
    render(await RestaurantsPage());
    const region = screen.getByRole("region", { name: /Want to try/ });
    expect(region.textContent).toContain("No places yet.");
    expect(within(region).getByRole("link", { name: "Add place" }).getAttribute("href")).toBe("/restaurants/new");
  });
});

describe("a place's page (REQ-129)", () => {
  const open = (id: string) => RestaurantPage({ params: Promise.resolve({ id }) });

  it("shows its address, hours, website, and who added it and when", async () => {
    given();
    render(await open("r2"));
    expect(screen.getByRole("heading", { name: "Corner Noodle Bar" })).toBeTruthy();
    const details = screen.getAllByRole("definition")[0].closest("dl")!;
    expect(details.textContent).toContain("12 Invented St, New York");
    expect(details.textContent).toContain("Monday: 11 AM – 10 PM");
    expect(details.textContent).toContain("Tuesday: Closed");
    expect(within(details).getByRole("link", { name: "corner-noodles.example" }).getAttribute("href")).toBe(
      "https://www.corner-noodles.example/menu",
    );
    expect(details.textContent).toContain("Alex, 27 Sept 2026");
    expect(screen.getByText("A. Photographer")).toBeTruthy();
    expect(places.details).toHaveBeenCalledWith("ChIJInventedNoodles01", "detail");
  });

  it("removes a place only after a confirm", async () => {
    given();
    render(await open("r1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const sheet = screen.getByRole("dialog", { name: "Remove Taqueria Pretend" });
    expect(sheet.textContent).toContain("Take Taqueria Pretend off Want to try?");
    expect(within(sheet).getByRole("button", { name: "Yes, remove it" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("isn't there for a place that isn't saved", async () => {
    given();
    await expect(open("nope")).rejects.toThrow("NOT_FOUND");
  });
});

describe("Add place (REQ-90, REQ-130)", () => {
  it("asks for a Google Maps or Apple Maps link", async () => {
    given();
    render(await AddPlacePage());
    expect(screen.getByRole("textbox", { name: "Google Maps or Apple Maps link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find place" })).toBeTruthy();
  });
});
