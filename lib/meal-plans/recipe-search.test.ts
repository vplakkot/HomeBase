import { describe, expect, it, vi } from "vitest";
import {
  MAX_PAGES,
  isPublicPage,
  isRecipePage,
  linksFrom,
  pagesFrom,
  readPage,
  recipeTextFrom,
  suggestionsFrom,
  titleFrom,
} from "./recipe-search";

// Shaped like Gemini's answer to a grounded search, as seen on
// 2026-09-27: each page a "grounding chunk" with the site's name and a
// Google redirect link. The sites here are invented.
const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";
const chunk = (id: string, site: string) => ({ web: { uri: `${REDIRECT}${id}`, title: site } });
const reply = (chunks: unknown[]) => ({
  candidates: [
    {
      content: { parts: [{ text: "Here are some pages." }] },
      groundingMetadata: { groundingChunks: chunks, searchEntryPoint: { renderedContent: "<div>chips</div>" } },
    },
  ],
});

// Google's redirect links answer 302 with the page's address.
function redirects(where: Record<string, string>) {
  return vi.fn(async (link: string | URL | Request) => {
    const id = String(link).slice(REDIRECT.length);
    return new Response(null, { status: 302, headers: where[id] ? { location: where[id] } : {} });
  }) as unknown as typeof fetch;
}

describe("reading a search's answer (REQ-112)", () => {
  it("takes Google's redirect links and the site each names, and the suggestions to show", () => {
    const answer = reply([chunk("a", "curry.example.com"), { web: { uri: "https://elsewhere.example/x", title: "x" } }]);
    expect(linksFrom(answer)).toEqual([{ link: `${REDIRECT}a`, site: "curry.example.com" }]);
    expect(suggestionsFrom(answer)).toBe("<div>chips</div>");
    expect(linksFrom({})).toEqual([]);
    expect(suggestionsFrom({})).toBeNull();
  });

  it("offers real addresses, recipe sites only, each once, at most five", async () => {
    const answer = reply([
      chunk("a", "curry.example.com"),
      chunk("b", "facebook.com"),
      chunk("c", "curry.example.com"),
      chunk("d", "stews.example.org"),
      chunk("e", "nowhere.example"),
      ...["f", "g", "h", "i", "j"].map((id) => chunk(id, `${id}.example.com`)),
    ]);
    const pages = await pagesFrom(
      answer,
      redirects({
        a: "https://curry.example.com/2026/06/test-chicken-curry/",
        b: "https://www.facebook.com/somepage/posts/1",
        c: "https://curry.example.com/2026/06/test-chicken-curry/",
        d: "https://stews.example.org/recipes/lamb-stew.html",
        f: "https://f.example.com/f",
        g: "https://g.example.com/g",
        h: "https://h.example.com/h",
        i: "https://i.example.com/i",
        j: "https://j.example.com/j",
      }),
    );
    expect(pages.slice(0, 2)).toEqual([
      { url: "https://curry.example.com/2026/06/test-chicken-curry/", site: "curry.example.com", title: "Test chicken curry" },
      { url: "https://stews.example.org/recipes/lamb-stew.html", site: "stews.example.org", title: "Lamb stew" },
    ]);
    expect(pages).toHaveLength(MAX_PAGES);
  });

  it("titles a page from its address, or its site when the address has no words", () => {
    expect(titleFrom("https://a.example.com/recipes/easy_beef-ragu/")).toBe("Easy beef ragu");
    expect(titleFrom("https://www.a.example.com/")).toBe("a.example.com");
    expect(titleFrom("https://a.example.com/chicken-shawarma-267380")).toBe("Chicken shawarma");
  });

  it("leaves out social media, where the video we already have lives", () => {
    expect(isRecipePage("https://www.instagram.com/reel/x")).toBe(false);
    expect(isRecipePage("https://m.youtube.com/watch?v=x")).toBe(false);
    expect(isRecipePage("https://curry.example.com/x")).toBe(true);
  });
});

describe("reading the page we picked (REQ-112)", () => {
  it("fetches only ordinary public https pages", () => {
    expect(isPublicPage("https://curry.example.com/x")).toBe(true);
    for (const bad of [
      "http://curry.example.com/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://router.local/x",
      "https://intranet/x",
      "https://user:pw@curry.example.com/x",
      "https://curry.example.com:8443/x",
      "not a link",
      42,
    ]) {
      expect(isPublicPage(bad)).toBe(false);
    }
  });

  it("uses a page's recipe block when it has one, and its words when it doesn't", () => {
    const withBlock = `<html><script type="application/ld+json">{"@type":"Recipe","name":"Test curry"}</script><p>Ads and stories</p></html>`;
    expect(recipeTextFrom(withBlock)).toBe(`{"@type":"Recipe","name":"Test curry"}`);
    const plain = `<html><head><style>p{}</style><script>var x;</script></head><body><nav>Menu</nav><p>200 g chicken &amp; rice</p></body></html>`;
    expect(recipeTextFrom(plain)).toBe("200 g chicken & rice");
  });

  it("follows a redirect to another public page, but never to a private one", async () => {
    const pages: Record<string, Response> = {
      "https://curry.example.com/old": new Response(null, { status: 301, headers: { location: "/new" } }),
      "https://curry.example.com/new": new Response("<p>Fry 200 g chicken.</p>", { status: 200 }),
      "https://sneaky.example.com/x": new Response(null, { status: 302, headers: { location: "https://127.0.0.1/admin" } }),
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => pages[String(url)]) as unknown as typeof fetch;
    expect(await readPage("https://curry.example.com/old", fetchImpl)).toBe("Fry 200 g chicken.");
    await expect(readPage("https://sneaky.example.com/x", fetchImpl)).rejects.toThrow("Not a public web page");
    expect(fetchImpl).not.toHaveBeenCalledWith("https://127.0.0.1/admin", expect.anything());
  });

  it("fails plainly on a page that won't open", async () => {
    const fetchImpl = vi.fn(async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    await expect(readPage("https://curry.example.com/x", fetchImpl)).rejects.toThrow("The page answered 404");
  });
});
