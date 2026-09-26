import { describe, expect, it, vi } from "vitest";
import { visionLines, visionReader, type VisionResponse } from "./vision";

// Shaped like Vision's reply to images:annotate: words made of symbols,
// with where each sits, how sure Vision was, and what break follows.
// The text is an invented label.
const word = (text: string, top: number, height: number, confidence = 0.98, after = "SPACE") => ({
  confidence,
  boundingBox: { vertices: [{ x: 0, y: top }, { x: 10, y: top }, { x: 10, y: top + height }, { x: 0, y: top + height }] },
  symbols: [...text].map((char, index) => ({
    text: char,
    ...(index === text.length - 1 ? { property: { detectedBreak: { type: after } } } : {}),
  })),
});
const RESPONSE = {
  fullTextAnnotation: {
    pages: [
      {
        blocks: [
          {
            paragraphs: [
              { words: [word("BODEGAS", 10, 60), word("FICTICIAS", 10, 60, 0.98, "LINE_BREAK")] },
              { words: [word("Reserva", 100, 90), word("Especial", 100, 90, 0.6, "LINE_BREAK")] },
              { words: [word("2019", 220, 35, 0.99, "EOL_SURE_SPACE")] },
            ],
          },
        ],
      },
    ],
  },
} as VisionResponse;

describe("reading Vision's answer (REQ-27)", () => {
  it("turns it into printed lines, with each line's height and its least sure word", () => {
    expect(visionLines(RESPONSE, 0)).toEqual([
      { text: "BODEGAS FICTICIAS", height: 60, confidence: 0.98, photo: 0 },
      { text: "Reserva Especial", height: 90, confidence: 0.6, photo: 0 },
      { text: "2019", height: 35, confidence: 0.99, photo: 0 },
    ]);
  });

  it("finds nothing in a photo with no text", () => {
    expect(visionLines({}, 0)).toEqual([]);
  });
});

describe("asking Vision (REQ-27)", () => {
  const photo = new Blob(["jpeg"], { type: "image/jpeg" });

  it("sends every photo in one request with the key, and reads the reply into a drink's details", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ responses: [RESPONSE, {}] })));
    const reading = await visionReader("test-key", fetch as unknown as typeof globalThis.fetch)([photo, photo]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate?key=test-key");
    const body = JSON.parse(String(init.body));
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]).toEqual({ image: { content: "anBlZw==" }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] });
    expect(reading).toMatchObject({ found: true, fields: { producer: "BODEGAS FICTICIAS", name: "Reserva Especial", vintage: 2019 } });
    // Read with little confidence, so marked to check.
    expect(reading.unsure).toContain("name");
  });

  it("fails loudly when Vision refuses, so the review screen opens empty and Sentry hears why", async () => {
    const refused = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(visionReader("bad", refused as unknown as typeof globalThis.fetch)([photo])).rejects.toThrow("Vision answered 403");
    const failed = vi.fn(async () => new Response(JSON.stringify({ responses: [{ error: { message: "Bad image data." } }] })));
    await expect(visionReader("k", failed as unknown as typeof globalThis.fetch)([photo])).rejects.toThrow("Vision: Bad image data.");
  });
});
