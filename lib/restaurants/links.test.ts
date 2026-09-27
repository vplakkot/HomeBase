import { describe, expect, it, vi } from "vitest";
import { followShortLink, readLink } from "./links";

// Invented places and IDs; the link shapes are Google's and Apple's.
const PLACE_ID = "ChIJInventedPlace0001";

describe("reading a Google Maps link (REQ-90)", () => {
  it("reads a place's name and its pin from a full link", () => {
    const link =
      "https://www.google.com/maps/place/Corner+Noodle+Bar/@40.7223,-73.9875,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d40.72231!4d-73.98742";
    expect(readLink(link)).toEqual({
      kind: "named",
      source: "google",
      name: "Corner Noodle Bar",
      near: { latitude: 40.72231, longitude: -73.98742 },
    });
  });

  it("undoes the link's escaping in the name", () => {
    const reading = readLink("https://www.google.com/maps/place/Caf%C3%A9+L'%C3%89toile/@48.85,2.35,17z");
    expect(reading).toMatchObject({ name: "Café L'Étoile", near: { latitude: 48.85, longitude: 2.35 } });
  });

  it("goes straight to the place when the link carries Google's place ID", () => {
    for (const link of [
      `https://www.google.com/maps/search/?api=1&query=Somewhere&query_place_id=${PLACE_ID}`,
      `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`,
      `https://www.google.com/maps/place/Somewhere/@1,2,17z/data=!4m2!3m1!19s${PLACE_ID}`,
    ]) {
      expect(readLink(link), link).toEqual({ kind: "place_id", placeId: PLACE_ID });
    }
  });

  it("reads a name-and-address link that marks one place", () => {
    expect(readLink("https://maps.google.com/?q=Corner+Noodle+Bar,+12+Invented+St&ftid=0x1:0x2")).toEqual({
      kind: "named",
      source: "google",
      name: "Corner Noodle Bar, 12 Invented St",
      near: null,
    });
  });

  it("finds the link in a shared message", () => {
    expect(readLink("Corner Noodle Bar https://maps.app.goo.gl/AbCdEf123")).toMatchObject({ kind: "short" });
  });

  it("says directions, a search and a dropped pin aren't one restaurant", () => {
    for (const link of [
      "https://www.google.com/maps/dir/Home/Corner+Noodle+Bar/@40.7,-73.9,14z",
      "https://www.google.com/maps/search/noodles+near+me/@40.7,-73.9,14z",
      "https://www.google.com/maps/place/40%C2%B043'20.3%22N+73%C2%B059'14.7%22W/@40.72,-73.98,17z",
      "https://www.google.com/maps/place/40.7223,-73.9875/@40.72,-73.98,17z",
      "https://www.google.com/maps/@40.72,-73.98,15z",
      "https://maps.google.com/?q=noodles",
    ]) {
      expect(readLink(link), link).toEqual({ kind: "not_a_place" });
    }
  });

  it("says a link from anywhere else isn't a maps link", () => {
    expect(readLink("https://example.com/maps/place/Nowhere")).toEqual({ kind: "not_a_maps_link" });
    expect(readLink("https://google.evil.example/maps/place/X/@1,2,3z")).toEqual({ kind: "not_a_maps_link" });
    expect(readLink("http://maps.app.goo.gl/AbCdEf123")).toEqual({ kind: "not_a_maps_link" });
    expect(readLink("https://maps.app.goo.gl:8443/AbCdEf123")).toEqual({ kind: "not_a_maps_link" });
    expect(readLink("https://www.google.co.uk/maps/place/Somewhere/@51.5,-0.1,17z")).toMatchObject({ kind: "named" });
    expect(readLink("just some words")).toEqual({ kind: "not_a_maps_link" });
  });
});

describe("reading an Apple Maps link (REQ-130)", () => {
  it("reads the name and spot from a newer place link", () => {
    expect(
      readLink("https://maps.apple.com/place?address=12%20Invented%20St&coordinate=40.7223,-73.9874&name=Corner%20Noodle%20Bar&place-id=I123"),
    ).toEqual({ kind: "named", source: "apple", name: "Corner Noodle Bar", near: { latitude: 40.7223, longitude: -73.9874 } });
  });

  it("reads the name and spot from an older ?q=&ll= link", () => {
    expect(readLink("https://maps.apple.com/?q=Corner%20Noodle%20Bar&ll=40.7223,-73.9874&t=m")).toEqual({
      kind: "named",
      source: "apple",
      name: "Corner Noodle Bar",
      near: { latitude: 40.7223, longitude: -73.9874 },
    });
  });

  it("opens Apple's short share link", () => {
    expect(readLink("https://maps.apple/p/AbC123")).toMatchObject({ kind: "short" });
  });

  it("says a dropped pin or directions aren't one restaurant", () => {
    expect(readLink("https://maps.apple.com/?ll=40.72,-73.98&q=Dropped%20Pin")).toEqual({ kind: "not_a_place" });
    expect(readLink("https://maps.apple.com/?saddr=Home&daddr=Corner%20Noodle%20Bar")).toEqual({ kind: "not_a_place" });
  });
});

describe("opening a share link", () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it("follows Google's redirects to the full link", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/place/Corner+Noodle+Bar/@40.72,-73.98,17z"));
    const reading = await followShortLink(new URL("https://maps.app.goo.gl/AbCdEf123"), fetchImpl);
    expect(reading).toMatchObject({ kind: "named", name: "Corner Noodle Bar" });
    expect(fetchImpl).toHaveBeenCalledWith(new URL("https://maps.app.goo.gl/AbCdEf123"), expect.objectContaining({ redirect: "manual" }));
  });

  it("never follows a redirect away from a maps address", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect("https://evil.example/maps/place/X/@1,2,3z"));
    expect(await followShortLink(new URL("https://maps.app.goo.gl/AbCdEf123"), fetchImpl)).toEqual({ kind: "not_a_place" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up on a link that goes nowhere", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("gone", { status: 404 }));
    expect(await followShortLink(new URL("https://maps.app.goo.gl/Nothing"), fetchImpl)).toEqual({ kind: "not_a_place" });
  });
});

describe("reading an OpenTable link (REQ-131)", () => {
  it("reads the restaurant's name and city from the link, and keeps it without its tracking", () => {
    expect(readLink("https://www.opentable.com/r/corner-noodle-bar-new-york?corrid=abc&avt=xyz#photos")).toEqual({
      kind: "opentable",
      name: "corner noodle bar new york",
      bookingUrl: "https://www.opentable.com/r/corner-noodle-bar-new-york",
    });
  });

  it("reads a country's OpenTable, a language in front, and the older one-word address", () => {
    expect(readLink("https://www.opentable.co.uk/r/pretend-bistro-london")).toMatchObject({ name: "pretend bistro london" });
    expect(readLink("https://www.opentable.ca/fr-CA/r/pretend-bistro-montreal")).toMatchObject({ name: "pretend bistro montreal" });
    expect(readLink("https://opentable.com/pretendbistro")).toMatchObject({ kind: "opentable", name: "pretendbistro" });
  });

  it("drops a number OpenTable adds at the end of the name", () => {
    expect(readLink("https://www.opentable.com/r/pretend-bistro-chicago-2")).toMatchObject({ name: "pretend bistro chicago" });
  });

  it("finds the link inside a shared message", () => {
    expect(readLink("Book with me! https://www.opentable.com/r/pretend-bistro-boston")).toMatchObject({ kind: "opentable" });
  });

  it("says a numbered page, a search or OpenTable's own pages don't name a restaurant", () => {
    for (const link of [
      "https://www.opentable.com/restaurant/profile/123456",
      "https://www.opentable.com/s?term=noodles",
      "https://www.opentable.com/metro/new-york-restaurants",
      "https://www.opentable.com/",
    ]) {
      expect(readLink(link), link).toEqual({ kind: "opentable_unnamed" });
    }
  });

  it("isn't fooled by a look-alike address", () => {
    expect(readLink("https://opentable.com.evil.example/r/pretend")).toEqual({ kind: "not_a_maps_link" });
    expect(readLink("https://myopentable.com/r/pretend")).toEqual({ kind: "not_a_maps_link" });
    expect(readLink("http://www.opentable.com/r/pretend")).toEqual({ kind: "not_a_maps_link" });
  });
});
