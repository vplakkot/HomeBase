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
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return false;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  return true;
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

// Downloads the page we picked. A redirect is followed only to another
// public address, three at most.
export async function readPage(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let at = url;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!isPublicPage(at)) throw new Error("Not a public web page");
    const response = await fetchImpl(at, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HomeBase recipe reader)", Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    const next = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && next) {
      at = new URL(next, at).toString();
      continue;
    }
    if (!response.ok) throw new Error(`The page answered ${response.status}`);
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > MAX_PAGE_BYTES) throw new Error("The page is too big");
    const html = (await response.text()).slice(0, MAX_PAGE_BYTES);
    return recipeTextFrom(html);
  }
  throw new Error("Too many redirects");
}
