// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { placesFromEnv, type Place, type Places } from "../../lib/restaurants/places";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import RestaurantPage from "./[id]/page";
import BeenToPage from "./been-to/page";
import AddPlacePage from "./new/page";
import RestaurantsPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/restaurants/places", async (original) => ({
  ...(await original<typeof import("../../lib/restaurants/places")>()),
  placesFromEnv: vi.fn(),
}));
vi.mock("./actions", () => ({
  lookUpPlace: vi.fn(),
  addPlace: vi.fn(),
  removePlace: vi.fn(),
  addBookingLink: vi.fn(),
  setBookingLink: vi.fn(),
  markTried: vi.fn(),
  undoTried: vi.fn(),
  answerGoAgain: vi.fn(),
}));
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
  { id: "r2", google_place_id: "ChIJInventedNoodles01", added_by: "user-2", created_at: "2026-09-27T12:00:00Z", booking_url: null, tried_on: null },
  { id: "r1", google_place_id: "ChIJInventedTaqueria1", added_by: "user-1", created_at: "2026-09-20T12:00:00Z", booking_url: null, tried_on: null },
];
// A third place, tried on 25 Sept; the viewer (fakeSupabase signs in as
// user-1, Sam) is asked about it until they answer.
const TRIED = {
  id: "r3",
  google_place_id: "ChIJInventedDumpling",
  added_by: "user-2",
  created_at: "2026-09-10T12:00:00Z",
  booking_url: "https://www.opentable.com/r/dumpling-pretend-new-york",
  tried_on: "2026-09-25",
};
// A fourth, added after the third but tried before it, to show Been to
// goes by the day tried, not the day added.
const TRIED_EARLIER = {
  id: "r4",
  google_place_id: "ChIJInventedPhoHouse",
  added_by: "user-1",
  created_at: "2026-09-11T12:00:00Z",
  booking_url: null,
  tried_on: "2026-09-12",
};
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
  ChIJInventedPhoHouse: place("ChIJInventedPhoHouse", { name: "Pretend Pho House", cuisine: "Vietnamese", neighborhood: "Lower East Side" }),
  ChIJInventedDumpling: place("ChIJInventedDumpling", {
    name: "Dumpling Pretend",
    mapsUrl: "https://maps.google.com/?cid=1234567890",
  }),
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

function given(rows: unknown[] = ROWS, answers: unknown[] = []) {
  const fake = fakeSupabase({ permissions: ["use_modules"], people: PEOPLE, tables: { restaurants: rows, restaurant_answers: answers } });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

type Params = Record<string, string>;
const home = (params: Params = {}) => RestaurantsPage({ searchParams: Promise.resolve(params) });
const beenTo = (params: Params = {}) => BeenToPage({ searchParams: Promise.resolve(params) });

const tiles = () => within(screen.getByRole("region", { name: /Want to try/ })).queryAllByRole("link");

describe("Want to try (REQ-129)", () => {
  it("shows each place as a tile with Google's photo, name, cuisine and neighbourhood, newest first", async () => {
    given();
    render(await home());
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
    render(await home());
    const tacos = tiles()[1];
    expect(tacos.querySelector("img")).toBeNull();
    expect(tacos.querySelector('[aria-hidden="true"]')?.className).toMatch(/noPhoto/);
  });

  it("still lists a place Google can't answer for, so it can be opened and removed", async () => {
    given();
    vi.mocked(places.details).mockRejectedValue(new Error("Google down"));
    render(await home());
    expect(tiles().map((tile) => tile.textContent)).toEqual(["Couldn't load from Google", "Couldn't load from Google"]);
  });

  it("with no places, says so and offers Add place", async () => {
    given([]);
    render(await home());
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

describe("Add place (REQ-90, REQ-130, REQ-131)", () => {
  it("asks for a Google Maps, Apple Maps or OpenTable link", async () => {
    given();
    render(await AddPlacePage());
    expect(screen.getByRole("textbox", { name: "Google Maps, Apple Maps or OpenTable link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find place" })).toBeTruthy();
  });
});

describe("book a table (REQ-132)", () => {
  const open = (id: string) => RestaurantPage({ params: Promise.resolve({ id }) });

  it("shows Book, opening the place's booking link, and Open in Google Maps", async () => {
    given([...ROWS, TRIED]);
    render(await open("r3"));
    const book = screen.getByRole("link", { name: "Book" });
    expect(book.getAttribute("href")).toBe("https://www.opentable.com/r/dumpling-pretend-new-york");
    expect(book.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "Open in Google Maps" }).getAttribute("href")).toBe("https://maps.google.com/?cid=1234567890");
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("has no Book without a booking link, but offers to add one by pasting it", async () => {
    given();
    render(await open("r1"));
    expect(screen.queryByRole("link", { name: "Book" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add booking link" }));
    const sheet = screen.getByRole("dialog", { name: "Add booking link" });
    const field = within(sheet).getByRole("textbox", { name: /OpenTable, Resy, Tock/ }) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("changes a booking link starting from the current one", async () => {
    given([...ROWS, TRIED]);
    render(await open("r3"));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const sheet = screen.getByRole("dialog", { name: "Change booking link" });
    expect((within(sheet).getByRole("textbox", { name: /OpenTable/ }) as HTMLInputElement).value).toBe(TRIED.booking_url);
  });
});

describe("mark as tried and go again (REQ-133)", () => {
  const open = (id: string) => RestaurantPage({ params: Promise.resolve({ id }) });

  it("offers Mark as tried on a place not yet tried, with nothing to fill in", async () => {
    given();
    render(await open("r1"));
    const button = screen.getByRole("button", { name: "Mark as tried" });
    const fields = [...button.closest("form")!.querySelectorAll("input")];
    expect(fields.map((input) => [input.type, input.name, input.value])).toEqual([["hidden", "id", "r1"]]);
  });

  it("takes a tried place off Want to try and asks the viewer, until they answer", async () => {
    given([...ROWS, TRIED]);
    render(await home());
    expect(tiles().map((tile) => tile.textContent)).toEqual([expect.stringContaining("Corner Noodle"), expect.stringContaining("Taqueria")]);
    expect(screen.getByRole("region", { name: /Want to try/ }).textContent).toContain("· 2");
    const ask = screen.getByRole("region", { name: "Go again?" });
    expect(ask.textContent).toContain("Dumpling Pretend");
    const answer = within(ask).getByRole("form", { name: "Go again to Dumpling Pretend?" });
    expect(within(answer).getByRole("button", { name: "Yes" }).getAttribute("value")).toBe("yes");
    expect(within(answer).getByRole("button", { name: "No" }).getAttribute("value")).toBe("no");
  });

  it("stops asking the viewer once they've answered, whatever the other person said", async () => {
    given([...ROWS, TRIED], [{ restaurant_id: "r3", user_id: "user-1", go_again: true }]);
    render(await home());
    expect(screen.queryByRole("region", { name: "Go again?" })).toBeNull();
  });

  it("still asks the viewer when only the other person has answered", async () => {
    given([...ROWS, TRIED], [{ restaurant_id: "r3", user_id: "user-2", go_again: false }]);
    render(await home());
    expect(screen.getByRole("region", { name: "Go again?" }).textContent).toContain("Dumpling Pretend");
  });

  it("shows a tried place's date and each answer; only the viewer's own can be changed", async () => {
    given([...ROWS, TRIED], [
      { restaurant_id: "r3", user_id: "user-1", go_again: false },
    ]);
    render(await open("r3"));
    expect(screen.queryByRole("button", { name: "Mark as tried" })).toBeNull();
    const details = screen.getAllByRole("definition")[0].closest("dl")!;
    expect(details.textContent).toContain("25 Sept 2026");
    const answers = screen.getByRole("region", { name: "Go again?" });
    const [you, alex] = within(answers).getAllByRole("listitem");
    expect(you.textContent).toContain("You");
    expect(within(you).getByRole("button", { name: "No" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(you).getByRole("button", { name: "Yes" }).getAttribute("aria-pressed")).toBe("false");
    expect(alex.textContent).toBe("AlexWaiting");
    expect(within(alex).queryByRole("button")).toBeNull();
  });

  it("undoes tried only after a confirm that says both answers go", async () => {
    given([...ROWS, TRIED]);
    render(await open("r3"));
    fireEvent.click(screen.getByRole("button", { name: "Undo tried" }));
    const sheet = screen.getByRole("dialog", { name: "Undo tried" });
    expect(sheet.textContent).toContain("Put Dumpling Pretend back on Want to try? Both go-again answers are cleared.");
    expect(within(sheet).getByRole("button", { name: "Yes, undo it" })).toBeTruthy();
  });
});

describe("Been to (REQ-134)", () => {
  const open = (id: string) => RestaurantPage({ params: Promise.resolve({ id }) });
  const beenTiles = () => within(screen.getByRole("region", { name: /Been to/ })).queryAllByRole("link");

  it("is a tab beside Want to try", async () => {
    given([...ROWS, TRIED]);
    render(await beenTo());
    const tab = within(screen.getByRole("navigation", { name: "Restaurants sections" })).getByRole("link", { name: "Been to" });
    expect(tab.getAttribute("href")).toBe("/restaurants/been-to");
    expect(tab.getAttribute("aria-current")).toBe("page");
  });

  it("shows each tried place as a tile like Want to try, most recently tried first", async () => {
    given([...ROWS, TRIED_EARLIER, TRIED]);
    render(await beenTo());
    const [dumplings, pho] = beenTiles();
    expect(beenTiles()).toHaveLength(2);
    expect(dumplings.textContent).toContain("Dumpling Pretend");
    expect(dumplings.getAttribute("href")).toBe("/restaurants/r3");
    expect(pho.textContent).toContain("Pretend Pho House");
    expect(pho.textContent).toContain("Vietnamese · Lower East Side");
    expect(screen.getByRole("region", { name: /Been to/ }).textContent).toContain("· 2");
    expect(places.details).toHaveBeenCalledWith("ChIJInventedPhoHouse", "tile");
  });

  it("shows each person's answer on a tile: Yes, No or waiting", async () => {
    given([...ROWS, TRIED_EARLIER, TRIED], [
      { restaurant_id: "r3", user_id: "user-1", go_again: true },
      { restaurant_id: "r3", user_id: "user-2", go_again: false },
      { restaurant_id: "r4", user_id: "user-2", go_again: true },
    ]);
    render(await beenTo());
    const [dumplings, pho] = beenTiles();
    expect(dumplings.textContent).toContain("You: Yes");
    expect(dumplings.textContent).toContain("Alex: No");
    expect(pho.textContent).toContain("You: Waiting");
    expect(pho.textContent).toContain("Alex: Yes");
  });

  it("opens to the place's detail: date tried, both answers, Book, Google Maps, and a way back to Been to", async () => {
    given([...ROWS, TRIED], [{ restaurant_id: "r3", user_id: "user-2", go_again: true }]);
    render(await open("r3"));
    expect(screen.getAllByRole("definition")[0].closest("dl")!.textContent).toContain("25 Sept 2026");
    const [you, alex] = within(screen.getByRole("region", { name: "Go again?" })).getAllByRole("listitem");
    expect(you.textContent).toContain("You");
    expect(alex.textContent).toBe("AlexYes");
    expect(screen.getByRole("link", { name: "Book" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Google Maps" })).toBeTruthy();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link").getAttribute("href")).toBe("/restaurants/been-to");
  });

  it("with nothing tried, says so", async () => {
    given();
    render(await beenTo());
    expect(beenTiles()).toHaveLength(0);
    expect(screen.getByRole("region", { name: /Been to/ }).textContent).toContain("Nowhere yet.");
  });
});

describe("filter by area and cuisine (REQ-135)", () => {
  // A third untried place sharing the noodle bar's neighbourhood.
  const MORE = [
    ...ROWS,
    { id: "r5", google_place_id: "ChIJInventedPhoHouse", added_by: "user-1", created_at: "2026-09-01T12:00:00Z", booking_url: null, tried_on: null },
  ];
  const optionsOf = (name: string) =>
    [...(screen.getByRole("combobox", { name }) as HTMLSelectElement).options].map((option) => option.textContent);

  it("lists only the neighbourhoods and cuisines Google gives for the places on that page", async () => {
    given(MORE);
    render(await home());
    expect(optionsOf("Neighborhood")).toEqual(["Any neighborhood", "Lower East Side", "Mission"]);
    expect(optionsOf("Cuisine")).toEqual(["Any cuisine", "Mexican", "Noodle", "Vietnamese"]);
  });

  it("filters by neighbourhood, and by both together", async () => {
    given(MORE);
    render(await home({ area: "Lower East Side" }));
    expect(tiles().map((tile) => tile.textContent)).toEqual([
      "Clear",
      expect.stringContaining("Corner Noodle Bar"),
      expect.stringContaining("Pretend Pho House"),
    ]);
    cleanup();
    render(await home({ area: "Lower East Side", cuisine: "Vietnamese" }));
    const shown = tiles().filter((link) => link.textContent !== "Clear");
    expect(shown.map((tile) => tile.textContent)).toEqual([expect.stringContaining("Pretend Pho House")]);
    expect((screen.getByRole("combobox", { name: "Cuisine" }) as HTMLSelectElement).value).toBe("Vietnamese");
  });

  it("says when nothing matches, and Clear goes back to every place", async () => {
    given(MORE);
    render(await home({ area: "Mission", cuisine: "Noodle" }));
    const region = screen.getByRole("region", { name: /Want to try/ });
    expect(region.textContent).toContain("No places match.");
    expect(within(region).getByRole("link", { name: "Clear" }).getAttribute("href")).toBe("/restaurants");
  });

  it("has no Clear while nothing is filtered", async () => {
    given(MORE);
    render(await home());
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
  });

  it("works on Been to, from the tried places' own neighbourhoods and cuisines", async () => {
    given([...ROWS, TRIED_EARLIER, TRIED]);
    render(await beenTo({ cuisine: "Vietnamese" }));
    expect(optionsOf("Cuisine")).toEqual(["Any cuisine", "Vietnamese"]);
    expect(optionsOf("Neighborhood")).toEqual(["Any neighborhood", "Lower East Side"]);
    const region = screen.getByRole("region", { name: /Been to/ });
    expect(within(region).getAllByRole("link").map((link) => link.textContent)).toEqual(["Clear", expect.stringContaining("Pretend Pho House")]);
    expect(within(region).getByRole("link", { name: "Clear" }).getAttribute("href")).toBe("/restaurants/been-to");
  });
});
