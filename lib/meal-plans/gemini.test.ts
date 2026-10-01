import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CARD_RULES,
  MODEL,
  genericPrompt,
  openVideoUpload,
  pagePrompt,
  readingFrom,
  recipeFromImages,
  recipeFromText,
  recipeFromVideo,
  searchRecipePages,
  videoState,
} from "./gemini";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const reply = (answer: object, thought = "thinking about it") =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: thought, thought: true }, { text: JSON.stringify(answer) }] } }] }));

const CARD = { found: true, name: "x", ingredients: [{ item: "rice" }], steps: ["Cook 1 cup rice."], guessed: [] };

describe("the card rules Gemini is given (REQ-110)", () => {
  it("asks for quantities inside every step, never just 'the remaining'", () => {
    expect(CARD_RULES).toContain('"Add 1 tsp cumin", "Add the remaining 1 tsp cumin"');
  });

  it("gives the four cooking methods, Air fryer winning over Oven", () => {
    expect(CARD_RULES).toContain("Stove top, Air fryer, Instant Pot, Oven");
    expect(CARD_RULES).toContain("both the oven and an air fryer is Air fryer");
  });

  it("asks for the fields it estimated to be named (REQ-111) and forbids inventing a recipe (REQ-112)", () => {
    expect(CARD_RULES).toContain('list the field in "guessed"');
    expect(CARD_RULES).toContain("Never invent a recipe in its place.");
  });
});

describe("reading a recipe (REQ-111, REQ-112)", () => {
  it("reads from the video only, at high media resolution, with the card's layout", async () => {
    fetchMock.mockResolvedValue(reply(CARD));
    const reading = await recipeFromVideo("Test rice", { uri: "https://files.example/abc", mimeType: "video/quicktime" });
    expect(reading).toMatchObject({ draft: { steps: ["Cook 1 cup rice."] } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/models/${MODEL}:generateContent`);
    expect(init.headers["x-goog-api-key"]).toBe("test-key-not-real");
    const body = JSON.parse(init.body);
    expect(body.generationConfig.mediaResolution).toBe("MEDIA_RESOLUTION_HIGH");
    expect(body.generationConfig.responseSchema.properties.cooking_method.enum).toEqual(["Stove top", "Air fryer", "Instant Pot", "Oven"]);
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ file_data: { mime_type: "video/quicktime", file_uri: "https://files.example/abc" } });
    expect(parts[1].text).toContain("from this cooking video only");
    expect(parts).toHaveLength(2);
  });

  it("sends typed text in any form with the same rules", async () => {
    fetchMock.mockResolvedValue(reply(CARD));
    await recipeFromText("Test rice", "rice, water, salt. boil");
    const text = JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(text).toContain(CARD_RULES);
    expect(text).toContain("rice, water, salt. boil");
  });

  it("says so when Gemini found no recipe, never an empty card", () => {
    expect(readingFrom({ candidates: [{ content: { parts: [{ text: '{"found":false,"ingredients":[],"steps":[],"guessed":[]}' }] } }] })).toEqual({
      error: "Gemini found no recipe in it.",
    });
    expect(readingFrom({ candidates: [] })).toEqual({ error: "Gemini's answer couldn't be read." });
  });

  it("reports an error answer as a failure", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));
    expect(await recipeFromText("x", "y")).toEqual({ error: "Gemini answered 429." });
  });
});

describe("the video's trip to Google (REQ-112)", () => {
  it("opens a resumable upload for the video's size and type and returns its link", async () => {
    fetchMock.mockResolvedValue(new Response(null, { headers: { "x-goog-upload-url": "https://upload.example/one-time" } }));
    expect(await openVideoUpload(1234, "video/mp4", "Test rice")).toBe("https://upload.example/one-time");
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toMatchObject({
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": "1234",
      "X-Goog-Upload-Header-Content-Type": "video/mp4",
    });
  });

  it("takes Google's 500 while processing as not ready yet, not a failure", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    expect(await videoState("files/abc")).toEqual({ state: "UNKNOWN" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: "ACTIVE", uri: "u", mimeType: "video/mp4" })));
    expect(await videoState("files/abc")).toEqual({ state: "ACTIVE", uri: "u", mimeType: "video/mp4" });
  });
});

describe("asking how much of a video arrived (REQ-112)", () => {
  it("reads a finished upload's file name, and a going one's size", async () => {
    const { uploadProgress } = await import("./gemini");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ file: { name: "files/abc" } }), { headers: { "x-goog-upload-status": "final" } }));
    expect(await uploadProgress("https://upload.example/x")).toEqual({ final: true, file: "files/abc" });
    fetchMock.mockResolvedValueOnce(new Response(null, { headers: { "x-goog-upload-status": "active", "x-goog-upload-size-received": "8388608" } }));
    expect(await uploadProgress("https://upload.example/x")).toEqual({ final: false, received: 8388608 });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "X-Goog-Upload-Command": "query" });
  });
});

describe("the web flows (REQ-112, flows 2 and 3)", () => {
  it("reads a picked page for that page's recipe only, never inventing one", () => {
    const prompt = pagePrompt("Test curry", "Fry 200 g chicken.");
    expect(prompt).toContain("from this web page only");
    expect(prompt).toContain("Fry 200 g chicken.");
    expect(prompt).toContain("Never invent a recipe in its place.");
    expect(prompt).not.toContain("title as the page gives it");
  });

  it("names a pasted link's recipe from the page itself (REQ-150)", () => {
    const prompt = pagePrompt("", "Test curry. Fry 200 g chicken.");
    expect(prompt).toContain("Read the recipe from this web page only");
    expect(prompt).toContain("give the recipe's own title as the page gives it");
    expect(prompt).toContain("Never invent a recipe in its place.");
  });

  it("only the generic version, asked for on a Recipe missing card, may write a recipe of its own", () => {
    const prompt = genericPrompt("Test curry");
    expect(prompt).not.toContain("Never invent a recipe");
    expect(prompt).toContain('Write a typical home version of "Test curry"');
    expect(prompt).toContain('"Add 1 tsp cumin"');
  });

  it("searches with Gemini's Google Search tool and keeps only the pages Google found", async () => {
    const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    fetchMock.mockImplementation(async (url: string) =>
      url === REDIRECT
        ? new Response(null, { status: 302, headers: { location: "https://curry.example.com/test-curry/" } })
        : new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: "See https://made-up.example/recipe" }] },
                  groundingMetadata: {
                    groundingChunks: [{ web: { uri: REDIRECT, title: "curry.example.com" } }],
                    searchEntryPoint: { renderedContent: "<div>chips</div>" },
                  },
                },
              ],
            }),
          ),
    );
    expect(await searchRecipePages("Test curry")).toEqual({
      pages: [{ url: "https://curry.example.com/test-curry/", site: "curry.example.com", title: "Test curry" }],
      suggestions: "<div>chips</div>",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/models/${MODEL}:generateContent`);
    const body = JSON.parse(init.body);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.contents[0].parts[0].text).toContain('"Test curry"');
  });

  it("says so when the search fails", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await searchRecipePages("Test curry")).toEqual({ error: "Gemini answered 503." });
  });
});

describe("reading a recipe from pictures (REQ-157)", () => {
  const answer = (extra: object) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ found: true, name: "Test dal", ingredients: [], steps: ["Boil 1 cup dal."], guessed: [], ...extra }) }] } }] }));
  const pictures = [{ mime: "image/jpeg", data: "AAAA" }, { mime: "image/jpeg", data: "BBBB" }];

  it("sends every picture, numbered, with nothing stored at Google", async () => {
    fetchMock.mockResolvedValue(answer({ photo_image: 2 }));
    await recipeFromImages(pictures);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const parts = body.contents[0].parts;
    expect(parts.map((part: Record<string, unknown>) => part.text ?? "image")).toEqual(["Image 1:", "image", "Image 2:", "image", expect.stringContaining("these 2 images")]);
    expect(parts[1].inline_data).toEqual({ mime_type: "image/jpeg", data: "AAAA" });
    expect(fetchMock.mock.calls[0][0]).not.toContain("/upload/");
  });

  it("turns the picture Gemini names into a position, or none", async () => {
    fetchMock.mockResolvedValue(answer({ photo_image: 2 }));
    expect(await recipeFromImages(pictures)).toEqual({ draft: expect.objectContaining({ name: "Test dal" }), photo: 1 });
    for (const photo_image of [0, 3, -1, 1.5, "1", undefined]) {
      fetchMock.mockResolvedValue(answer({ photo_image }));
      expect(await recipeFromImages(pictures)).toEqual({ draft: expect.anything(), photo: null });
    }
  });

  it("says so when there is no recipe in them, and on a Gemini error", async () => {
    fetchMock.mockResolvedValue(answer({ found: false }));
    expect(await recipeFromImages(pictures)).toEqual({ error: "Gemini found no recipe in it." });
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    expect(await recipeFromImages(pictures)).toEqual({ error: "Gemini answered 500." });
  });
});

describe("the photo moment Gemini names while watching a video (REQ-156)", () => {
  const answer = (extra: object) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ found: true, name: "Test dal", ingredients: [], steps: ["Boil 1 cup dal."], guessed: [], ...extra }) }] } }] }));
  const file = { uri: "https://files.example/v", mimeType: "video/mp4" };

  it("asks for the second of the finished dish with no person in view", async () => {
    fetchMock.mockResolvedValue(answer({ photo_at: 48 }));
    await recipeFromVideo("", file);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.responseSchema.properties.photo_at.description).toContain("no person or any part of one");
    expect(body.contents[0].parts[1].text).toContain("never a moment with any person in view");
  });

  it("returns that second with the recipe, or none for -1, a missing or a nonsense answer", async () => {
    fetchMock.mockResolvedValue(answer({ photo_at: 48.5 }));
    expect(await recipeFromVideo("", file)).toEqual({ draft: expect.objectContaining({ name: "Test dal" }), photoAt: 48.5 });
    for (const photo_at of [-1, "48", undefined, null]) {
      fetchMock.mockResolvedValue(answer({ photo_at }));
      expect(await recipeFromVideo("", file)).toEqual({ draft: expect.anything(), photoAt: null });
    }
  });

  it("still says so when there is no recipe, and on a Gemini error", async () => {
    fetchMock.mockResolvedValue(answer({ found: false, photo_at: 3 }));
    expect(await recipeFromVideo("", file)).toEqual({ error: "Gemini found no recipe in it." });
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    expect(await recipeFromVideo("", file)).toEqual({ error: "Gemini answered 500." });
  });
});
