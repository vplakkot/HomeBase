import { describe, expect, it } from "vitest";
import { metresBetween, pickMatch, sameName } from "./match";
import type { Place } from "./places";

// Invented places around an invented corner.
const HERE = { latitude: 40.7223, longitude: -73.9874 };

function place(name: string, northMetres = 0): Place {
  return {
    placeId: `ChIJ${name.replace(/\W/g, "")}000000`,
    name,
    address: null,
    location: { latitude: HERE.latitude + northMetres / 111_195, longitude: HERE.longitude },
    cuisine: null,
    neighborhood: null,
    hours: [],
    website: null,
    mapsUrl: null,
    photo: null,
  };
}

describe("matching a link to what Google found (REQ-130)", () => {
  it("measures distance on the ground", () => {
    expect(metresBetween(HERE, place("x", 100).location!)).toBeCloseTo(100, 0);
  });

  it("agrees on names that differ only in small ways", () => {
    expect(sameName("Corner Noodle Bar", "The Corner Noodle Bar")).toBe(true);
    expect(sameName("Katz's Delicatessen", "Katz's Deli")).toBe(true);
    expect(sameName("Café Étoile", "Cafe Etoile")).toBe(true);
    expect(sameName("Joe's Pizza", "Joe's Shanghai")).toBe(false);
  });

  it("is confident about one place with the same name right at the spot", () => {
    const found = [place("Corner Noodle Bar", 20), place("Noodle Palace", 40)];
    expect(pickMatch("Corner Noodle Bar", HERE, found)).toEqual({ kind: "one", place: found[0] });
  });

  it("isn't confident about the same name streets away, and offers what's nearby", () => {
    const found = [place("Corner Noodle Bar", 600), place("Noodle Palace", 300)];
    expect(pickMatch("Corner Noodle Bar", HERE, found)).toEqual({ kind: "choose", places: found });
  });

  it("offers at most three, only nearby ones", () => {
    const found = [place("A One", 100), place("B Two", 200), place("C Three", 300), place("D Four", 400), place("Far", 5000)];
    const match = pickMatch("Something Else", HERE, found);
    expect(match).toEqual({ kind: "choose", places: found.slice(0, 3) });
  });

  it("says nothing was found when Google found nothing near", () => {
    expect(pickMatch("Corner Noodle Bar", HERE, [])).toEqual({ kind: "none" });
    expect(pickMatch("Corner Noodle Bar", HERE, [place("Elsewhere", 9000)])).toEqual({ kind: "none" });
  });
});
