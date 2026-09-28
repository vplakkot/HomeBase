import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleStatus } from "../module-status";
import { followShortLink, readLink, type LinkReading } from "./links";
import { MAX_CANDIDATES, pickMatch, sameName, type Match } from "./match";
import type { Places } from "./places";

// Restaurants (REQ-90, REQ-129 to REQ-133): the places we want to try and
// have tried. A row is Google's place ID, who added it and when, its
// booking link and the day we tried it; everything else is asked of
// Google when the place is shown.

export type Restaurant = {
  id: string;
  google_place_id: string;
  added_by: string | null;
  created_at: string;
  booking_url: string | null;
  // Empty while the place is on Want to try (REQ-133).
  tried_on: string | null;
};

// REQ-133: one person's "go again?" for one tried place.
export type Answer = { restaurant_id: string; user_id: string; go_again: boolean };

export async function readRestaurants(supabase: SupabaseClient): Promise<Restaurant[]> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, google_place_id, added_by, created_at, booking_url, tried_on")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not read Restaurants: ${error.message}`);
  return (data ?? []) as Restaurant[];
}

export async function readAnswers(supabase: SupabaseClient): Promise<Answer[]> {
  const { data, error } = await supabase.from("restaurant_answers").select("restaurant_id, user_id, go_again");
  if (error) throw new Error(`Could not read go-again answers: ${error.message}`);
  return (data ?? []) as Answer[];
}

// REQ-133: the tried places this person hasn't said "go again?" about
// yet, most recently tried first. Each of us is asked separately, and the
// question stays until it's answered.
export function waitingOn<T extends Pick<Restaurant, "id" | "tried_on">>(
  rows: readonly T[],
  answers: readonly Pick<Answer, "restaurant_id" | "user_id">[],
  userId: string,
): T[] {
  const answered = new Set(answers.filter((answer) => answer.user_id === userId).map((answer) => answer.restaurant_id));
  return rows
    .filter((row) => row.tried_on !== null && !answered.has(row.id))
    .sort((a, b) => (b.tried_on ?? "").localeCompare(a.tried_on ?? ""));
}

// What Home needs: how many are still to try, and how many tried places
// this person hasn't answered for. No Google call.
export async function readRestaurantsSummary(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ toTry: number; unanswered: number }> {
  const [{ data, error }, answers] = await Promise.all([
    supabase.from("restaurants").select("id, tried_on"),
    supabase.from("restaurant_answers").select("restaurant_id, user_id").eq("user_id", userId),
  ]);
  if (error) throw new Error(`Could not read Restaurants: ${error.message}`);
  if (answers.error) throw new Error(`Could not read go-again answers: ${answers.error.message}`);
  const rows = (data ?? []) as Pick<Restaurant, "id" | "tried_on">[];
  return {
    toTry: rows.filter((row) => row.tried_on === null).length,
    unanswered: waitingOn(rows, (answers.data ?? []) as Answer[], userId).length,
  };
}

// Less urgent than anything Finances (1 to 12) or Paperwork (13) raises:
// nothing is lost by answering tomorrow.
export const GO_AGAIN_RANK = 14;

// Home's tile says how many are left to try, and asks "go again?" of the
// person looking while they have a tried place to answer for (REQ-133).
export function restaurantsTile({ toTry, unanswered }: { toTry: number; unanswered: number }): ModuleStatus {
  const status = toTry === 0 ? "Nothing to try yet" : toTry === 1 ? "1 to try" : `${toTry} to try`;
  if (unanswered === 0) return { status, headline: status, facts: [], actionItems: [] };
  const text = unanswered === 1 ? "Go again? 1 place" : `Go again? ${unanswered} places`;
  return {
    status: text,
    headline: text,
    facts: [],
    actionItems: [{ text, detail: "Say whether you'd go back", rank: GO_AGAIN_RANK, href: "/restaurants" }],
  };
}

export const NOT_A_RESTAURANT = "Couldn't find a restaurant from that link. Share the place itself, not directions, a search or a dropped pin.";
export const NOT_A_MAPS_LINK = "That isn't a Google Maps, Apple Maps or OpenTable link.";
export const OPENTABLE_UNNAMED = "That OpenTable link doesn't say the restaurant's name. Share it from the restaurant's own page.";
export const NOTHING_FOUND = "Couldn't find that place in Google.";
export const ALREADY_SAVED = "Already on Want to try.";
export const ALREADY_TRIED = "Already on Been to.";

// REQ-132: a booking link is any web address (OpenTable, Resy, Tock or the
// place's own site); nothing else, so it can only ever open a web page.
export function bookingUrlFrom(pasted: string): string | null {
  const found = /https?:\/\/\S+/i.exec(pasted.trim())?.[0];
  if (!found) return null;
  try {
    const url = new URL(found);
    // The length the database will see, after the address is tidied.
    if (url.href.length > 2000) return null;
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// What a link found; an OpenTable link also brings its booking link.
export type Lookup =
  | (Exclude<Match, { kind: "none" }> & { bookingUrl?: string })
  | { kind: "error"; message: string };

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
    case "opentable_unnamed":
      return { kind: "error", message: OPENTABLE_UNNAMED };
    // REQ-131: OpenTable's name for it, looked up in Google with no spot
    // to go by. Only places whose name agrees count; none is "nothing
    // found", and more than one is a choice.
    case "opentable": {
      const agree = (await places.search(reading.name, null)).filter((place) => sameName(reading.name, place.name));
      if (agree.length === 0) return { kind: "error", message: NOTHING_FOUND };
      const match: Match =
        agree.length === 1 ? { kind: "one", place: agree[0] } : { kind: "choose", places: agree.slice(0, MAX_CANDIDATES) };
      return { ...match, bookingUrl: reading.bookingUrl };
    }
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
