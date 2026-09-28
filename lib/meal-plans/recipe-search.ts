import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// REQ-112's web flows: finding recipe pages for a dish by name, and
// reading the one we pick. The search is Gemini's own Google Search (Vin,
// 2026-09-27), with the same key as everything else Gemini does.
//
// What a search gives back (tried 2026-09-27): each page Google found as
// a "grounding chunk" with the site's name and a Google redirect link,
// plus a small piece of HTML, the "search suggestions", which Google's
// terms require us to show wherever the results are shown.

export type FoundPage = { url: string; site: string; title: string };
export type SearchResult = { pages: FoundPage[]; suggestions: string | null };

// How many pages we offer to pick from.
export const MAX_PAGES = 5;
// Places that hold posts about a recipe rather than the recipe: the video
// we already have is one of these.
const NOT_RECIPE_PAGES = [
  "facebook.com", "instagram.com", "tiktok.com", "youtube.com", "youtu.be", "reddit.com",
  "pinterest.com", "x.com", "twitter.com", "threads.net",
];

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";

export function searchPrompt(name: string): string {
  return `Find web pages with a full recipe (ingredients and steps) for the dish "${name}". Prefer recipe sites and cooking blogs; not social media posts or videos.`;
}

type Chunk = { web?: { uri?: string; title?: string } };

// The search's redirect links, in Google's order, with the site each
// names. Anything that isn't one of Google's redirect links is dropped.
export function linksFrom(reply: unknown): { link: string; site: string }[] {
  const metadata = (reply as { candidates?: { groundingMetadata?: { groundingChunks?: Chunk[] } }[] })?.candidates?.[0]
    ?.groundingMetadata;
  return (metadata?.groundingChunks ?? []).flatMap((chunk) => {
    const link = chunk.web?.uri;
    return typeof link === "string" && link.startsWith(REDIRECT) ? [{ link, site: chunk.web?.title ?? "" }] : [];
  });
}

export function suggestionsFrom(reply: unknown): string | null {
  const html = (reply as { candidates?: { groundingMetadata?: { searchEntryPoint?: { renderedContent?: unknown } } }[] })
    ?.candidates?.[0]?.groundingMetadata?.searchEntryPoint?.renderedContent;
  return typeof html === "string" && html.trim() ? html : null;
}

// Only an ordinary public web address is fetched: https, a real domain
// name, never an address typed as numbers or a name inside a network.
// The server fetches the page we pick, and the address comes from the
// browser, so this is what stops it being pointed anywhere else.
export function isPublicPage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // "localhost." is localhost: a name may end in a dot.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return false;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  return true;
}

// An address inside a network or on the machine itself: loopback,
// private ranges, link-local (where cloud servers answer questions about
// themselves), the carrier range, and their IPv6 counterparts.
export function isPrivateAddress(address: string): boolean {
  const mapped = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(mapped) === 4) {
    const [a, b] = mapped.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  return mapped === "::" || mapped === "::1" || /^f[cd]/.test(mapped) || /^fe[89ab]/.test(mapped);
}

// The name's actual addresses, looked up the way the download will: a
// public-looking name can still point inside a network, so every address
// it has must be public.
export async function pointsOutside(url: string, resolve: typeof lookup = lookup): Promise<boolean> {
  const host = new URL(url).hostname.replace(/\.+$/, "");
  const addresses = await resolve(host, { all: true }).catch(() => []);
  return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
}

export function isRecipePage(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  return !NOT_RECIPE_PAGES.some((site) => host === site || host.endsWith(`.${site}`));
}

// A readable title from the page's address, so offering five pages needs
// no five page downloads: ".../oven-roasted-chicken-shawarma/" becomes
// "Oven roasted chicken shawarma".
export function titleFrom(url: string): string {
  const { pathname, hostname } = new URL(url);
  const slug = pathname
    .split("/")
    .filter((part) => /[a-z]/i.test(part) && !/^\d+$/.test(part))
    .at(-1);
  // Words only: a site's own number on the end ("...-267380") is dropped.
  const words = (slug ?? "")
    .replace(/\.(html?|php|aspx?)$/i, "")
    .split(/[-_+]+/)
    .filter((word) => word && !/^\d+$/.test(word))
    .join(" ");
  if (!words) return hostname.replace(/^www\./, "");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

// Where one of Google's redirect links leads. It answers with a plain
// redirect (302 and the address), so nothing is downloaded.
export async function destination(link: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl(link, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const where = response.headers.get("location");
  return where && isPublicPage(where) ? where : null;
}

// The search's pages as we offer them: real addresses, recipe sites only,
// each once, at most five.
export async function pagesFrom(reply: unknown, fetchImpl: typeof fetch = fetch): Promise<FoundPage[]> {
  const resolved = await Promise.all(
    linksFrom(reply).map(async ({ link, site }) => {
      const url = await destination(link, fetchImpl).catch(() => null);
      return url && isRecipePage(url) ? { url, site: site || new URL(url).hostname.replace(/^www\./, ""), title: titleFrom(url) } : null;
    }),
  );
  const seen = new Set<string>();
  return resolved
    .filter((page): page is FoundPage => page !== null && !seen.has(page.url) && Boolean(seen.add(page.url)))
    .slice(0, MAX_PAGES);
}

// How much of a page is read, and how much of it goes to Gemini.
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
export const MAX_PAGE_TEXT = 30_000;

// A recipe page's recipe, as text for Gemini. Most recipe sites describe
// it in a block meant for search engines (JSON-LD "Recipe"), which is the
// recipe and nothing else; otherwise the page's words, without its code.
export function recipeTextFrom(html: string): string {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const recipes = blocks.filter((block) => /"@type"\s*:\s*(\[[^\]]*)?"Recipe"/.test(block));
  if (recipes.length > 0) return recipes.join("\n").slice(0, MAX_PAGE_TEXT);
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PAGE_TEXT);
}

// REQ-150: the page's own photo of the dish. Recipe sites name it in the
// same search-engine block ("image": a link, a list of links, or an
// object with a url), or as the picture shown when the page is shared
// (og:image). Only a public https address counts.
export function imageFrom(html: string, pageUrl: string): string | null {
  const candidates: unknown[] = [];
  for (const [, block] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      candidates.push(...recipeImages(JSON.parse(block)));
    } catch {
      // A block that isn't valid JSON is skipped.
    }
  }
  for (const tag of html.match(/<meta[^>]+>/gi) ?? []) {
    if (/(property|name)\s*=\s*["'](og:image|twitter:image)["']/i.test(tag)) {
      candidates.push(tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]);
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const url = new URL(candidate.trim().replace(/&amp;/g, "&"), pageUrl).toString();
      if (isPublicPage(url)) return url;
    } catch {
      // Not an address.
    }
  }
  return null;
}

// Every "image" a Recipe in a search-engine block names, wherever the
// Recipe sits: alone, in a list, or inside an "@graph".
function recipeImages(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(recipeImages);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  const own = types.includes("Recipe") ? imageLinks(node.image) : [];
  return [...own, ...recipeImages(node["@graph"])];
}

function imageLinks(image: unknown): unknown[] {
  if (Array.isArray(image)) return image.flatMap(imageLinks);
  if (image && typeof image === "object") return [(image as { url?: unknown }).url];
  return [image];
}

// No more than `limit` bytes of what a site sends: reading stops there
// rather than downloading it all.
async function firstBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(size, limit));
  let at = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - at);
    bytes.set(part, at);
    at += part.byteLength;
    if (at >= bytes.length) break;
  }
  return bytes;
}

// Downloads a public address. A redirect is followed only to another
// public address, three at most, and every hop's name is looked up first.
// (A name could still change what it points to between that look-up and
// the download; https to a real certificate, port 443 only, makes that
// hard to use.)
async function fetchPublic(
  url: string,
  accept: string,
  fetchImpl: typeof fetch,
  resolve: typeof lookup,
): Promise<Response> {
  let at = url;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!isPublicPage(at) || !(await pointsOutside(at, resolve))) throw new Error("Not a public web page");
    const response = await fetchImpl(at, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HomeBase recipe reader)", Accept: accept },
      signal: AbortSignal.timeout(15_000),
    });
    const next = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && next) {
      at = new URL(next, at).toString();
      continue;
    }
    if (!response.ok) throw new Error(`The page answered ${response.status}`);
    return response;
  }
  throw new Error("Too many redirects");
}

export type RecipePage = { text: string; image: string | null };

// A recipe page, read: its recipe as text for Gemini, and its photo's
// address if it names one (REQ-150).
export async function readRecipePage(
  url: string,
  fetchImpl: typeof fetch = fetch,
  resolve: typeof lookup = lookup,
): Promise<RecipePage> {
  const response = await fetchPublic(url, "text/html", fetchImpl, resolve);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_PAGE_BYTES) throw new Error("The page is too big");
  const html = new TextDecoder().decode(await firstBytes(response, MAX_PAGE_BYTES));
  return { text: recipeTextFrom(html), image: imageFrom(html, url) };
}

// The page we picked from a search (REQ-112), as text for Gemini.
export async function readPage(
  url: string,
  fetchImpl: typeof fetch = fetch,
  resolve: typeof lookup = lookup,
): Promise<string> {
  return (await readRecipePage(url, fetchImpl, resolve)).text;
}

// A photo is shrunk in the browser before it's kept, like any other
// (REQ-32), so this is only a ceiling on what's downloaded for it.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

// REQ-150: the page's photo, downloaded the same careful way as the page,
// as a data: address the browser can shrink. Anything that isn't a
// picture, or is bigger than the ceiling, is refused.
export async function readImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
  resolve: typeof lookup = lookup,
): Promise<string> {
  const response = await fetchPublic(url, IMAGE_TYPES.join(","), fetchImpl, resolve);
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(type)) throw new Error("Not a photo");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error("The photo is too big");
  // One byte past the ceiling is enough to know it's over.
  const bytes = await firstBytes(response, MAX_IMAGE_BYTES + 1);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("The photo is too big");
  if (bytes.length === 0) throw new Error("The photo is empty");
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}
