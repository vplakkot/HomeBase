import type { Spot } from "./links";

// Google Places (the "new" Places API): finding a place from a name and a
// spot, and loading a saved place's details each time it's shown (REQ-90:
// we keep only its ID). The key lives in Vercel as GOOGLE_PLACES_KEY,
// never in git, and goes to Google in a header from the server; the
// browser never sees it. Photos are handed to the browser as Google's own
// image links, which carry no key.

const BASE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 8000;

// What each screen needs, and no more: Google charges by the most
// expensive field asked for.
const FIELDS = {
  // The confirm card (REQ-90) and a candidate (REQ-130).
  found: ["id", "displayName", "formattedAddress", "location", "photos"],
  // A tile on Want to try (REQ-129).
  tile: ["id", "displayName", "primaryTypeDisplayName", "addressComponents", "photos"],
  // A place's own page (REQ-129).
  detail: [
    "id",
    "displayName",
    "primaryTypeDisplayName",
    "addressComponents",
    "photos",
    "formattedAddress",
    "regularOpeningHours",
    "websiteUri",
    "googleMapsUri",
  ],
} as const;

export type Level = keyof typeof FIELDS;

type Text = { text?: string };
type Photo = { name?: string; authorAttributions?: { displayName?: string; uri?: string }[] };
type AddressPart = { longText?: string; types?: string[] };

export type GooglePlace = {
  id: string;
  displayName?: Text;
  formattedAddress?: string;
  location?: Spot;
  photos?: Photo[];
  primaryTypeDisplayName?: Text;
  addressComponents?: AddressPart[];
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  websiteUri?: string;
  googleMapsUri?: string;
};

// A place as the screens use it.
export type Place = {
  placeId: string;
  name: string;
  address: string | null;
  location: Spot | null;
  cuisine: string | null;
  neighborhood: string | null;
  hours: string[];
  website: string | null;
  mapsUrl: string | null;
  // Google's name for its first photo, to turn into an image link, and
  // who took it (Google asks for the credit to be shown with the photo).
  photo: { name: string; credit: string | null } | null;
};

// "Italian Restaurant" → "Italian"; "Coffee Shop" stays; plain
// "Restaurant" says nothing a restaurant list needs to repeat.
export function cuisineFrom(type: string | undefined): string | null {
  const text = type?.trim() ?? "";
  if (text === "" || /^restaurant$/i.test(text)) return null;
  return text.replace(/\s+restaurant$/i, "");
}

// The smallest area Google names for the address: a neighbourhood, else a
// district, else the town.
export function neighborhoodFrom(parts: AddressPart[] | undefined): string | null {
  for (const type of ["neighborhood", "sublocality_level_1", "sublocality", "locality", "postal_town"]) {
    const part = parts?.find((candidate) => candidate.types?.includes(type));
    if (part?.longText) return part.longText;
  }
  return null;
}

function web(link: string | undefined): string | null {
  return link && /^https?:\/\//i.test(link) ? link : null;
}

export function toPlace(google: GooglePlace): Place {
  const first = google.photos?.find((photo) => photo.name);
  return {
    placeId: google.id,
    name: google.displayName?.text ?? "Unnamed place",
    address: google.formattedAddress ?? null,
    location: google.location ?? null,
    cuisine: cuisineFrom(google.primaryTypeDisplayName?.text),
    neighborhood: neighborhoodFrom(google.addressComponents),
    hours: google.regularOpeningHours?.weekdayDescriptions ?? [],
    // Links shown as links: web addresses only.
    website: web(google.websiteUri),
    mapsUrl: web(google.googleMapsUri),
    photo: first?.name ? { name: first.name, credit: first.authorAttributions?.[0]?.displayName ?? null } : null,
  };
}

export class PlacesError extends Error {}

export type Places = {
  details(placeId: string, level: Level): Promise<Place | null>;
  search(name: string, near: Spot | null): Promise<Place[]>;
  photoLink(photoName: string, width: number): Promise<string | null>;
};

export const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export function googlePlaces(apiKey: string, fetchImpl: typeof fetch = fetch): Places {
  const headers = (fields: readonly string[]) => ({
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": fields.join(","),
  });

  return {
    async details(placeId, level) {
      const reply = await fetchImpl(`${BASE}/places/${encodeURIComponent(placeId)}`, {
        headers: headers(FIELDS[level]),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // A place Google no longer knows (removed, or its ID retired).
      if (reply.status === 404) return null;
      if (!reply.ok) throw new PlacesError(`Google Places answered ${reply.status}`);
      return toPlace((await reply.json()) as GooglePlace);
    },

    async search(name, near) {
      const reply = await fetchImpl(`${BASE}/places:searchText`, {
        method: "POST",
        headers: headers(FIELDS.found.map((field) => `places.${field}`)),
        body: JSON.stringify({
          textQuery: name,
          pageSize: 5,
          ...(near ? { locationBias: { circle: { center: near, radius: 500 } } } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!reply.ok) throw new PlacesError(`Google Places answered ${reply.status}`);
      const { places = [] } = (await reply.json()) as { places?: GooglePlace[] };
      return places.map(toPlace);
    },

    async photoLink(photoName, width) {
      if (!PHOTO_NAME.test(photoName)) return null;
      const reply = await fetchImpl(`${BASE}/${photoName}/media?maxWidthPx=${width}&skipHttpRedirect=true`, {
        headers: { "X-Goog-Api-Key": apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!reply.ok) return null;
      const { photoUri } = (await reply.json()) as { photoUri?: string };
      return photoUri?.startsWith("https://") ? photoUri : null;
    },
  };
}

// The client with the key from Vercel, or null where it isn't set (a
// machine without the key, or a test).
export function placesFromEnv(): Places | null {
  const key = process.env.GOOGLE_PLACES_KEY;
  return key ? googlePlaces(key) : null;
}
