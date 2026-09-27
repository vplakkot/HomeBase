// Reading a pasted maps link (REQ-90, REQ-130) or OpenTable link
// (REQ-131). A maps link says which place it is in one of two ways:
// Google's own place ID, which needs no further guessing, or a name and a
// spot on the map, which Google is then asked to find. Anything else
// (directions, a search, a dropped pin) isn't one restaurant. An OpenTable
// link names the restaurant (and usually its city) in its address, and is
// kept as the place's booking link.

export type Spot = { latitude: number; longitude: number };

export type LinkReading =
  | { kind: "place_id"; placeId: string }
  | { kind: "named"; source: "google" | "apple"; name: string; near: Spot | null }
  // A share link (maps.app.goo.gl, maps.apple/p/…) that has to be opened
  // to see where it leads.
  | { kind: "short"; url: URL }
  // "carbone new york" from opentable.com/r/carbone-new-york, and the link
  // itself without its tracking to book with.
  | { kind: "opentable"; name: string; bookingUrl: string }
  | { kind: "opentable_unnamed" }
  | { kind: "not_a_place" }
  | { kind: "not_a_maps_link" };

const PLACE_ID = /^[A-Za-z0-9_-]{10,255}$/;

// google.com and Google's country domains (google.co.uk, google.com.au…),
// with www. or maps. in front, and nothing that merely starts with google.
const GOOGLE_HOSTS = /^(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const APPLE_HOSTS = /^(maps\.apple\.com|maps\.apple)$/;
const OPENTABLE_HOSTS = /^(www\.)?opentable\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
// OpenTable's own pages, which share the one-word address a restaurant's
// old-style link uses (opentable.com/carbone).
const OPENTABLE_PAGES = new Set([
  "s", "r", "restaurant", "restaurants", "restref", "start", "user", "my", "landmark", "metro", "region",
  "neighborhood", "cuisine", "gift-cards", "about", "promo", "blog", "info", "c", "lists", "booking",
]);
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "maps.apple"]);

// Every host a link, or a share link's redirect, may lead to. Nothing else
// is ever fetched, so a pasted link can't make the server call anywhere.
export function isMapsHost(host: string): boolean {
  return SHORT_HOSTS.has(host) || GOOGLE_HOSTS.test(host) || APPLE_HOSTS.test(host);
}

function spot(latitude: string | undefined, longitude: string | undefined): Spot | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || latitude === "" || longitude === "") return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

function spotFrom(value: string | null): Spot | null {
  if (!value) return null;
  const [lat, lng] = value.split(",");
  return spot(lat?.trim(), lng?.trim());
}

// "Katz's+Delicatessen" in a path, with its + and %xx undone.
function pathName(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, " ")).trim();
  } catch {
    return segment.replace(/\+/g, " ").trim();
  }
}

// A dropped pin is named by its own position: "40°44'N 73°59'W" or
// "40.7484,-73.9857".
function looksLikeCoordinates(name: string): boolean {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(name) || /\d+°/.test(name);
}

function placeIdFrom(value: string | null): string | null {
  const id = value?.replace(/^place_id:/, "").trim() ?? "";
  return PLACE_ID.test(id) ? id : null;
}

function readGoogle(url: URL): LinkReading {
  const path = url.pathname;
  // A place ID written into the link: ?q=place_id:…, ?query_place_id=…,
  // ?place_id=…, or tucked into the map's data as !19s…
  const direct =
    placeIdFrom(url.searchParams.get("query_place_id")) ??
    placeIdFrom(url.searchParams.get("place_id")) ??
    (url.searchParams.get("q")?.startsWith("place_id:") ? placeIdFrom(url.searchParams.get("q")) : null) ??
    placeIdFrom(/!19s(ChIJ[A-Za-z0-9_-]+)/.exec(decodeURIComponent(path))?.[1] ?? null);
  if (direct) return { kind: "place_id", placeId: direct };

  if (/^\/maps\/dir(\/|$)/.test(path)) return { kind: "not_a_place" };

  // /maps/place/Katz's+Delicatessen/@40.7222,-73.9874,17z/data=…
  const place = /^\/maps\/place\/([^/]+)(?:\/@(-?[\d.]+),(-?[\d.]+))?/.exec(path);
  if (place) {
    const name = pathName(place[1]);
    // The map's own pin, !3d<lat>!4d<lng>, is the place itself; the @ is
    // only where the map was centred.
    const pin = /!3d(-?[\d.]+)!4d(-?[\d.]+)/.exec(path);
    const near = spot(pin?.[1], pin?.[2]) ?? spot(place[2], place[3]);
    if (name === "" || looksLikeCoordinates(name)) return { kind: "not_a_place" };
    return { kind: "named", source: "google", name, near };
  }

  // ?q=Katz's Delicatessen, 205 E Houston St&ftid=0x…:0x… — the ftid or
  // cid marks it as one place rather than a search, and the q is its name
  // and address.
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q !== "" && (url.searchParams.has("ftid") || url.searchParams.has("cid")) && !looksLikeCoordinates(q)) {
    return { kind: "named", source: "google", name: q, near: null };
  }

  // Everything else (a search, a bare map, ?cid=… without a name) doesn't
  // name one place we can look up.
  return { kind: "not_a_place" };
}

function readApple(url: URL): LinkReading {
  const params = url.searchParams;
  if (params.has("daddr") || params.has("saddr") || url.pathname.startsWith("/directions")) {
    return { kind: "not_a_place" };
  }
  // maps.apple.com/place?name=…&coordinate=lat,lng (newer) or
  // maps.apple.com/?q=…&ll=lat,lng (older).
  const name = (params.get("name") ?? params.get("q") ?? "").trim();
  const near = spotFrom(params.get("coordinate")) ?? spotFrom(params.get("ll")) ?? spotFrom(params.get("sll"));
  if (name === "" || /^dropped pin$/i.test(name) || looksLikeCoordinates(name)) return { kind: "not_a_place" };
  return { kind: "named", source: "apple", name, near };
}

// opentable.com/r/carbone-new-york, opentable.co.uk/r/…, a language in
// front (/fr-CA/r/…) or the older opentable.com/carbone. A numbered page
// (/restaurant/profile/12345) doesn't say the restaurant's name.
function readOpenTable(url: URL): LinkReading {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length > 0 && /^[a-z]{2}(-[a-z]{2})?$/i.test(segments[0]) && segments.length > 1) segments.shift();
  let slug: string | undefined;
  if (segments.length === 2 && segments[0] === "r") slug = segments[1];
  else if (segments.length === 1 && !OPENTABLE_PAGES.has(segments[0].toLowerCase())) slug = segments[0];
  // The name's words, without a number OpenTable sometimes adds at the end.
  const name = slug ? pathName(slug.replace(/-/g, " ")).replace(/(\s+\d+)+$/, "").trim() : "";
  if (name === "" || /^\d+$/.test(name)) return { kind: "opentable_unnamed" };
  return { kind: "opentable", name, bookingUrl: `https://${url.hostname.toLowerCase()}${url.pathname}` };
}

export function readLink(pasted: string): LinkReading {
  // A share often arrives as "Katz's Delicatessen https://maps.app.goo.gl/…":
  // the link is the part that starts with https.
  const found = /https?:\/\/\S+/.exec(pasted.trim())?.[0];
  if (!found) return { kind: "not_a_maps_link" };
  let url: URL;
  try {
    url = new URL(found);
  } catch {
    return { kind: "not_a_maps_link" };
  }
  // Only plain https on the usual port, so a pasted link can't point the
  // server at anything unusual even on a maps host.
  if (url.protocol !== "https:" || url.port !== "") return { kind: "not_a_maps_link" };
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl" || (host === "goo.gl" && url.pathname.startsWith("/maps"))) return { kind: "short", url };
  if (host === "maps.apple" && url.pathname.startsWith("/p/")) return { kind: "short", url };
  if (GOOGLE_HOSTS.test(host) && (url.pathname.startsWith("/maps") || host.startsWith("maps."))) return readGoogle(url);
  if (APPLE_HOSTS.test(host)) return readApple(url);
  if (OPENTABLE_HOSTS.test(host)) return readOpenTable(url);
  return { kind: "not_a_maps_link" };
}

// Opens a share link, one redirect at a time, until it lands on a full
// maps link. Only maps hosts are followed, and never more than five hops.
export async function followShortLink(url: URL, fetchImpl: typeof fetch = fetch): Promise<LinkReading> {
  let at = url;
  for (let hop = 0; hop < 5; hop++) {
    const reply = await fetchImpl(at, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const location = reply.headers.get("location");
    if (reply.status < 300 || reply.status >= 400 || !location) return { kind: "not_a_place" };
    const next = new URL(location, at);
    if (next.protocol !== "https:" || next.port !== "" || !isMapsHost(next.hostname.toLowerCase())) return { kind: "not_a_place" };
    const reading = readLink(next.href);
    if (reading.kind !== "short") return reading;
    at = next;
  }
  return { kind: "not_a_place" };
}
