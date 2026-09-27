import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placesFromEnv, type Place, type Places } from "../../lib/restaurants/places";
import { ALREADY_SAVED, NOT_A_RESTAURANT, NOTHING_FOUND } from "../../lib/restaurants/restaurants";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import { addPlace, lookUpPlace, removePlace } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/restaurants/places", async (original) => ({
  ...(await original<typeof import("../../lib/restaurants/places")>()),
  placesFromEnv: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// Invented places and ids; nothing here is real.
const ROW = "11111111-1111-4111-8111-111111111111";
const HERE = { latitude: 40.7223, longitude: -73.9874 };

function place(placeId: string, name: string, location = HERE): Place {
  return { placeId, name, address: "12 Invented St", location, cuisine: null, neighborhood: null, hours: [], website: null, mapsUrl: null, photo: null };
}

let fake: ReturnType<typeof fakeSupabase>;
let places: Places;

function given({ permissions = ["use_modules"], saved = [] as unknown[] } = {}) {
  fake = fakeSupabase({ permissions, tables: { restaurants: saved } });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

beforeEach(() => {
  places = { details: vi.fn(), search: vi.fn(), photoLink: vi.fn() };
  vi.mocked(placesFromEnv).mockReturnValue(places);
});
afterEach(() => vi.clearAllMocks());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const table = () => fake.from.mock.results.find((_, index) => fake.from.mock.calls[index][0] === "restaurants")!.value;

describe("looking up a Google Maps link (REQ-90)", () => {
  it("finds the place and shows it to confirm", async () => {
    given();
    vi.mocked(places.search).mockResolvedValue([place("ChIJInventedNoodles01", "Corner Noodle Bar")]);
    const state = await lookUpPlace({}, form({ link: "https://www.google.com/maps/place/Corner+Noodle+Bar/@40.7223,-73.9874,17z" }));
    expect(state).toEqual({ places: [expect.objectContaining({ name: "Corner Noodle Bar", savedId: null })], choose: false });
    expect(places.search).toHaveBeenCalledWith("Corner Noodle Bar", HERE);
  });

  it("goes to Google by ID when the link has one", async () => {
    given();
    vi.mocked(places.details).mockResolvedValue(place("ChIJInventedNoodles01", "Corner Noodle Bar"));
    await lookUpPlace({}, form({ link: "https://www.google.com/maps/place/?q=place_id:ChIJInventedNoodles01" }));
    expect(places.details).toHaveBeenCalledWith("ChIJInventedNoodles01", "found");
  });

  it("says when the place is already saved, instead of offering to add it again", async () => {
    given({ saved: [{ id: ROW, google_place_id: "ChIJInventedNoodles01" }] });
    vi.mocked(places.search).mockResolvedValue([place("ChIJInventedNoodles01", "Corner Noodle Bar")]);
    const state = await lookUpPlace({}, form({ link: "https://www.google.com/maps/place/Corner+Noodle+Bar/@40.7223,-73.9874,17z" }));
    expect(state.places?.[0].savedId).toBe(ROW);
    expect(table().in).toHaveBeenCalledWith("google_place_id", ["ChIJInventedNoodles01"]);
  });

  it("says directions, a search or a dropped pin aren't a restaurant, without asking Google", async () => {
    given();
    for (const link of [
      "https://www.google.com/maps/dir/Home/Work",
      "https://www.google.com/maps/search/noodles",
      "https://www.google.com/maps/place/40.72,-73.98/@40.72,-73.98,17z",
    ]) {
      expect(await lookUpPlace({}, form({ link }))).toEqual({ error: NOT_A_RESTAURANT });
    }
    expect(places.search).not.toHaveBeenCalled();
  });

  it("says so when nothing is set up to ask Google", async () => {
    given();
    vi.mocked(placesFromEnv).mockReturnValue(null);
    expect(await lookUpPlace({}, form({ link: "https://maps.apple.com/?q=X&ll=1,2" }))).toEqual({
      error: "Looking places up isn't set up here yet (no Google key).",
    });
  });

  it("says so when Google doesn't answer", async () => {
    given();
    vi.mocked(places.search).mockRejectedValue(new Error("503"));
    expect(await lookUpPlace({}, form({ link: "https://maps.apple.com/?q=X&ll=1,2" }))).toEqual({
      error: "Google didn't answer. Try again in a moment.",
    });
  });
});

describe("looking up an Apple Maps link (REQ-130)", () => {
  const APPLE = "https://maps.apple.com/place?coordinate=40.7223,-73.9874&name=Corner%20Noodle%20Bar";

  it("looks the place up in Google near the link's spot, and offers one confident match", async () => {
    given();
    vi.mocked(places.search).mockResolvedValue([place("ChIJInventedNoodles01", "Corner Noodle Bar"), place("ChIJInventedOther001", "Noodle Palace")]);
    const state = await lookUpPlace({}, form({ link: APPLE }));
    expect(places.search).toHaveBeenCalledWith("Corner Noodle Bar", HERE);
    expect(state).toMatchObject({ choose: false, places: [{ placeId: "ChIJInventedNoodles01" }] });
  });

  it("offers up to three nearby places to pick from when no match is confident", async () => {
    given();
    const nearby = (id: string, name: string, north: number) =>
      place(id, name, { latitude: HERE.latitude + north / 111_195, longitude: HERE.longitude });
    vi.mocked(places.search).mockResolvedValue([
      nearby("ChIJInventedA0000001", "Alpha Diner", 200),
      nearby("ChIJInventedB0000001", "Beta Grill", 250),
      nearby("ChIJInventedC0000001", "Gamma Cafe", 300),
      nearby("ChIJInventedD0000001", "Delta Deli", 350),
    ]);
    const state = await lookUpPlace({}, form({ link: APPLE }));
    expect(state.choose).toBe(true);
    expect(state.places?.map((found) => found.placeId)).toEqual(["ChIJInventedA0000001", "ChIJInventedB0000001", "ChIJInventedC0000001"]);
  });

  it("says nothing was found when Google finds nothing near", async () => {
    given();
    vi.mocked(places.search).mockResolvedValue([]);
    expect(await lookUpPlace({}, form({ link: APPLE }))).toEqual({ error: NOTHING_FOUND });
  });

  it("says when the matched place is already saved", async () => {
    given({ saved: [{ id: ROW, google_place_id: "ChIJInventedNoodles01" }] });
    vi.mocked(places.search).mockResolvedValue([place("ChIJInventedNoodles01", "Corner Noodle Bar")]);
    expect((await lookUpPlace({}, form({ link: APPLE }))).places?.[0].savedId).toBe(ROW);
  });
});

describe("adding and removing (REQ-90, REQ-129)", () => {
  it("saves only Google's place ID, and goes back to Want to try", async () => {
    given();
    await expect(addPlace({}, form({ placeId: "ChIJInventedNoodles01" }))).rejects.toThrow("REDIRECT:/restaurants");
    // Who added it and when are filled in by the database (auth.uid(), now()).
    expect(table().insert).toHaveBeenCalledWith({ google_place_id: "ChIJInventedNoodles01" });
  });

  it("refuses a duplicate the database catches", async () => {
    given();
    const query = fake.from("restaurants");
    fake.from.mockClear();
    vi.mocked(query.insert as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve({ error: { code: "23505", message: "duplicate" } }));
    fake.from.mockReturnValue(query);
    expect(await addPlace({}, form({ placeId: "ChIJInventedNoodles01" }))).toEqual({ error: ALREADY_SAVED });
  });

  it("lets either member add, and nobody without module access", async () => {
    given({ permissions: [] });
    await expect(addPlace({}, form({ placeId: "ChIJInventedNoodles01" }))).rejects.toThrow("REDIRECT:/restaurants");
    expect(fake.from).not.toHaveBeenCalledWith("restaurants");
  });

  it("refuses something that isn't a place ID", async () => {
    given();
    expect(await addPlace({}, form({ placeId: "not a place; drop table" }))).toEqual({ error: "Nothing to add." });
  });

  it("removes a place and goes back to the list", async () => {
    given();
    await expect(removePlace({}, form({ id: ROW }))).rejects.toThrow("REDIRECT:/restaurants");
    expect(table().delete).toHaveBeenCalled();
    expect(table().eq).toHaveBeenCalledWith("id", ROW);
  });
});
