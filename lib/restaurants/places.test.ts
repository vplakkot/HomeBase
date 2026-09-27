import { describe, expect, it, vi } from "vitest";
import { cuisineFrom, googlePlaces, neighborhoodFrom, toPlace } from "./places";

// An invented key and place; nothing here reaches Google.
const KEY = "test-key-not-real";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("what a place looks like on screen (REQ-90, REQ-129)", () => {
  it("names the cuisine without repeating 'Restaurant'", () => {
    expect(cuisineFrom("Italian Restaurant")).toBe("Italian");
    expect(cuisineFrom("Coffee Shop")).toBe("Coffee Shop");
    expect(cuisineFrom("Restaurant")).toBeNull();
    expect(cuisineFrom(undefined)).toBeNull();
  });

  it("names the smallest area the address has", () => {
    expect(
      neighborhoodFrom([
        { longText: "New York", types: ["locality"] },
        { longText: "Lower East Side", types: ["neighborhood", "political"] },
      ]),
    ).toBe("Lower East Side");
    expect(neighborhoodFrom([{ longText: "Springfield", types: ["locality"] }])).toBe("Springfield");
    expect(neighborhoodFrom(undefined)).toBeNull();
  });

  it("shows only web addresses as links", () => {
    const place = toPlace({ id: "ChIJInvented000001", websiteUri: "javascript:alert(1)", googleMapsUri: "https://maps.google.com/?cid=1" });
    expect(place.website).toBeNull();
    expect(place.mapsUrl).toBe("https://maps.google.com/?cid=1");
  });

  it("keeps the first photo's name and its photographer", () => {
    const place = toPlace({
      id: "ChIJInvented000001",
      displayName: { text: "Corner Noodle Bar" },
      photos: [{ name: "places/ChIJInvented000001/photos/P1", authorAttributions: [{ displayName: "A. Photographer" }] }],
    });
    expect(place.photo).toEqual({ name: "places/ChIJInvented000001/photos/P1", credit: "A. Photographer" });
  });
});

describe("asking Google", () => {
  it("sends the key in a header, never in the address, and asks only for a tile's fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: "ChIJInvented000001", displayName: { text: "Corner Noodle Bar" } }));
    const place = await googlePlaces(KEY, fetchImpl).details("ChIJInvented000001", "tile");
    expect(place?.name).toBe("Corner Noodle Bar");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJInvented000001");
    expect(url).not.toContain(KEY);
    expect(init.headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(init.headers["X-Goog-FieldMask"]).toBe("id,displayName,primaryTypeDisplayName,addressComponents,photos");
  });

  it("treats a place Google no longer knows as gone", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: {} }, 404));
    expect(await googlePlaces(KEY, fetchImpl).details("ChIJInvented000001", "detail")).toBeNull();
  });

  it("searches by name near the link's spot", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ places: [{ id: "ChIJInvented000001" }] }));
    await googlePlaces(KEY, fetchImpl).search("Corner Noodle Bar", { latitude: 40.7, longitude: -73.9 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(JSON.parse(init.body)).toEqual({
      textQuery: "Corner Noodle Bar",
      pageSize: 5,
      locationBias: { circle: { center: { latitude: 40.7, longitude: -73.9 }, radius: 500 } },
    });
  });

  it("turns a photo's name into Google's own image link, which carries no key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ photoUri: "https://lh3.googleusercontent.example/abc" }));
    const link = await googlePlaces(KEY, fetchImpl).photoLink("places/ChIJInvented000001/photos/P1", 400);
    expect(link).toBe("https://lh3.googleusercontent.example/abc");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://places.googleapis.com/v1/places/ChIJInvented000001/photos/P1/media?maxWidthPx=400&skipHttpRedirect=true",
    );
  });

  it("refuses a photo name that isn't Google's shape", async () => {
    const fetchImpl = vi.fn();
    expect(await googlePlaces(KEY, fetchImpl).photoLink("../../elsewhere", 400)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
