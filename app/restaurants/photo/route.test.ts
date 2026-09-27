import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { placesFromEnv, type Places } from "../../../lib/restaurants/places";
import { createClient } from "../../../lib/supabase/server";
import { fakeSupabase } from "../../../test/fake-supabase";
import { GET } from "./route";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../../lib/restaurants/places", async (original) => ({
  ...(await original<typeof import("../../../lib/restaurants/places")>()),
  placesFromEnv: vi.fn(),
}));

// An invented photo; nothing here reaches Google.
const PHOTO = "places/ChIJInventedNoodles01/photos/P1";
let places: Places;

function given(signedIn = true) {
  const fake = fakeSupabase({ signedIn });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const ask = (query: string) => GET(new NextRequest(`https://homebase.example/restaurants/photo?${query}`));

beforeEach(() => {
  places = { details: vi.fn(), search: vi.fn(), photoLink: vi.fn(async () => "https://lh3.googleusercontent.example/abc") };
  vi.mocked(placesFromEnv).mockReturnValue(places);
});

describe("a place's photo (REQ-129)", () => {
  it("sends a signed-in member to Google's key-free image link, kept for a day", async () => {
    given();
    const reply = await ask(`name=${encodeURIComponent(PHOTO)}&w=400`);
    expect(reply.status).toBe(302);
    expect(reply.headers.get("location")).toBe("https://lh3.googleusercontent.example/abc");
    expect(reply.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(places.photoLink).toHaveBeenCalledWith(PHOTO, 400);
  });

  it("asks Google nothing for someone signed out", async () => {
    given(false);
    expect((await ask(`name=${encodeURIComponent(PHOTO)}`)).status).toBe(401);
    expect(places.photoLink).not.toHaveBeenCalled();
  });

  it("refuses anything that isn't a Google photo name, or an odd size", async () => {
    given();
    expect((await ask("name=../../secrets")).status).toBe(400);
    expect((await ask(`name=${encodeURIComponent(PHOTO)}&w=5000`)).status).toBe(400);
    expect(places.photoLink).not.toHaveBeenCalled();
  });

  it("says there's no photo when Google has none to give", async () => {
    given();
    vi.mocked(places.photoLink).mockResolvedValue(null);
    expect((await ask(`name=${encodeURIComponent(PHOTO)}`)).status).toBe(404);
  });
});
