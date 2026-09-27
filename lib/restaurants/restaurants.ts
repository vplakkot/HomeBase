import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleStatus } from "../module-status";
import { followShortLink, readLink, type LinkReading } from "./links";
import { pickMatch, type Match } from "./match";
import type { Places } from "./places";

// Restaurants (REQ-90, REQ-129, REQ-130): the places we want to try. A row
// is Google's place ID, who added it and when; everything else is asked of
// Google when the place is shown.

export type Restaurant = {
  id: string;
  google_place_id: string;
  added_by: string | null;
  created_at: string;
};

export async function readRestaurants(supabase: SupabaseClient): Promise<Restaurant[]> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, google_place_id, added_by, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not read Restaurants: ${error.message}`);
  return (data ?? []) as Restaurant[];
}

export async function countRestaurants(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase.from("restaurants").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not count Restaurants: ${error.message}`);
  return count ?? 0;
}

// Home's tile: nothing here needs anyone, so it's calm and says how many.
export function restaurantsTile(count: number): ModuleStatus {
  const status = count === 0 ? "Nothing saved yet" : count === 1 ? "1 to try" : `${count} to try`;
  return { status, headline: status, facts: [], actionItems: [] };
}

export const NOT_A_RESTAURANT = "Couldn't find a restaurant from that link. Share the place itself, not directions, a search or a dropped pin.";
export const NOT_A_MAPS_LINK = "That isn't a Google Maps or Apple Maps link.";
export const NOTHING_FOUND = "Couldn't find that place in Google.";
export const ALREADY_SAVED = "Already on Want to try.";

export type Lookup = Exclude<Match, { kind: "none" }> | { kind: "error"; message: string };

// A pasted link to the place it means: straight to Google by ID when the
// link carries one, otherwise a search by its name near its spot.
export async function lookUpLink(
  pasted: string,
  places: Places,
  fetchImpl: typeof fetch = fetch,
): Promise<Lookup> {
  let reading: LinkReading = readLink(pasted);
  if (reading.kind === "short") {
    try {
      reading = await followShortLink(reading.url, fetchImpl);
    } catch {
      return { kind: "error", message: "Couldn't open that share link. Try again." };
    }
  }
  switch (reading.kind) {
    case "not_a_maps_link":
      return { kind: "error", message: NOT_A_MAPS_LINK };
    case "not_a_place":
    case "short":
      return { kind: "error", message: NOT_A_RESTAURANT };
    case "place_id": {
      const place = await places.details(reading.placeId, "found");
      return place ? { kind: "one", place } : { kind: "error", message: NOTHING_FOUND };
    }
    case "named": {
      const match = pickMatch(reading.name, reading.near, await places.search(reading.name, reading.near));
      return match.kind === "none" ? { kind: "error", message: NOTHING_FOUND } : match;
    }
  }
}
