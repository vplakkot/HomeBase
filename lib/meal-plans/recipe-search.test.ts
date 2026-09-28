import { describe, expect, it, vi } from "vitest";
import {
  MAX_PAGES,
  isPrivateAddress,
  isPublicPage,
  pointsOutside,
  isRecipePage,
  linksFrom,
  pagesFrom,
  imageFrom,
  readImage,
  readPage,
  readRecipePage,
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

// Every name resolves to an ordinary public address.
const PUBLIC = (async () => [{ address: "93.184.216.34", family: 4 }]) as never;

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
      "https://localhost./x",
      "https://metadata.google.internal./x",
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

  it("knows the addresses inside a network or on the machine itself", () => {
    for (const inside of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(inside)).toBe(true);
    }
    for (const outside of ["93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(outside)).toBe(false);
    }
  });

  it("refuses a public-looking name that points inside a network, or doesn't resolve", async () => {
    const points = (...addresses: string[]) =>
      (async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))) as never;
    expect(await pointsOutside("https://curry.example.com/x", points("93.184.216.34"))).toBe(true);
    expect(await pointsOutside("https://127.0.0.1.nip.example/x", points("127.0.0.1"))).toBe(false);
    expect(await pointsOutside("https://mixed.example.com/x", points("93.184.216.34", "10.0.0.5"))).toBe(false);
    expect(await pointsOutside("https://nowhere.example/x", points())).toBe(false);
  });

  it("follows a redirect to another public page, but never to a private one", async () => {
    const pages: Record<string, Response> = {
      "https://curry.example.com/old": new Response(null, { status: 301, headers: { location: "/new" } }),
      "https://curry.example.com/new": new Response("<p>Fry 200 g chicken.</p>", { status: 200 }),
      "https://sneaky.example.com/x": new Response(null, { status: 302, headers: { location: "https://127.0.0.1/admin" } }),
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => pages[String(url)]) as unknown as typeof fetch;
    expect(await readPage("https://curry.example.com/old", fetchImpl, PUBLIC)).toBe("Fry 200 g chicken.");
    await expect(readPage("https://sneaky.example.com/x", fetchImpl, PUBLIC)).rejects.toThrow("Not a public web page");
    // A redirect to a name that points inside is refused before it's fetched.
    const inside = (async (host: string) =>
      [{ address: host === "curry.example.com" ? "93.184.216.34" : "10.0.0.5", family: 4 }]) as never;
    pages["https://curry.example.com/hop"] = new Response(null, { status: 302, headers: { location: "https://lan.example.com/admin" } });
    await expect(readPage("https://curry.example.com/hop", fetchImpl, inside)).rejects.toThrow("Not a public web page");
    expect(fetchImpl).not.toHaveBeenCalledWith("https://lan.example.com/admin", expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith("https://127.0.0.1/admin", expect.anything());
  });

  it("fails plainly on a page that won't open", async () => {
    const fetchImpl = vi.fn(async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    await expect(readPage("https://curry.example.com/x", fetchImpl, PUBLIC)).rejects.toThrow("The page answered 404");
  });

  it("stops reading a page at 3 MB, however much the site sends", async () => {
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024 * 1024;
        controller.enqueue(new TextEncoder().encode("a".repeat(1024 * 1024)));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(endless, { status: 200 })) as unknown as typeof fetch;
    const text = await readPage("https://curry.example.com/x", fetchImpl, PUBLIC);
    expect(text.length).toBeLessThanOrEqual(30_000);
    expect(sent).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});

// REQ-150: the page's own photo, from invented pages.
describe("a recipe page's photo (REQ-150)", () => {
  const PAGE = "https://curry.example.com/recipes/test-curry";

  it("finds the Recipe's image in the search-engine block, in any of its shapes", () => {
    const block = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
    expect(imageFrom(block({ "@type": "Recipe", image: "https://img.example.com/a.jpg" }), PAGE)).toBe("https://img.example.com/a.jpg");
    expect(imageFrom(block({ "@type": "Recipe", image: ["https://img.example.com/b.jpg", "https://img.example.com/c.jpg"] }), PAGE)).toBe(
      "https://img.example.com/b.jpg",
    );
    expect(imageFrom(block({ "@type": ["Recipe"], image: { "@type": "ImageObject", url: "/photos/d.jpg" } }), PAGE)).toBe(
      "https://curry.example.com/photos/d.jpg",
    );
    expect(
      imageFrom(block({ "@graph": [{ "@type": "WebPage", image: "https://img.example.com/page.jpg" }, { "@type": "Recipe", image: "https://img.example.com/e.jpg" }] }), PAGE),
    ).toBe("https://img.example.com/e.jpg");
  });

  it("falls back to the picture shown when the page is shared, and gives nothing when there's none", () => {
    expect(imageFrom('<meta content="https://img.example.com/og.jpg" property="og:image">', PAGE)).toBe("https://img.example.com/og.jpg");
    expect(imageFrom('<meta name="twitter:image" content="https://img.example.com/tw.jpg">', PAGE)).toBe("https://img.example.com/tw.jpg");
    expect(imageFrom("<p>No photo here.</p>", PAGE)).toBeNull();
    expect(imageFrom('<script type="application/ld+json">{not json</script>', PAGE)).toBeNull();
  });

  it("never offers an address that isn't a public https one", () => {
    expect(imageFrom('<meta property="og:image" content="http://img.example.com/a.jpg">', PAGE)).toBeNull();
    expect(imageFrom('<meta property="og:image" content="https://127.0.0.1/a.jpg">', PAGE)).toBeNull();
  });

  it("reads a page's recipe text and its photo's address together", async () => {
    const html = `<meta property="og:image" content="https://img.example.com/og.jpg"><p>Fry 200 g chicken.</p>`;
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    expect(await readRecipePage(PAGE, fetchImpl, PUBLIC)).toEqual({ text: "Fry 200 g chicken.", image: "https://img.example.com/og.jpg" });
  });

  it("downloads the photo as a data: address, and only a photo", async () => {
    const photo = (type: string, body: BodyInit = "pic") =>
      vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": type } })) as unknown as typeof fetch;
    expect(await readImage("https://img.example.com/a.jpg", photo("image/jpeg"), PUBLIC)).toBe(
      `data:image/jpeg;base64,${Buffer.from("pic").toString("base64")}`,
    );
    await expect(readImage("https://img.example.com/a.jpg", photo("text/html"), PUBLIC)).rejects.toThrow("Not a photo");
    await expect(readImage("https://img.example.com/a.jpg", photo("image/svg+xml"), PUBLIC)).rejects.toThrow("Not a photo");
    await expect(readImage("https://img.example.com/a.jpg", photo("image/jpeg", ""), PUBLIC)).rejects.toThrow("empty");
    await expect(readImage("https://127.0.0.1/a.jpg", photo("image/jpeg"), PUBLIC)).rejects.toThrow("Not a public web page");
  });

  it("stops downloading a photo past 5 MB, however much the site sends", async () => {
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024 * 1024;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(endless, { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    await expect(readImage("https://img.example.com/huge.png", fetchImpl, PUBLIC)).rejects.toThrow("too big");
    expect(sent).toBeLessThanOrEqual(7 * 1024 * 1024);
  });
});
