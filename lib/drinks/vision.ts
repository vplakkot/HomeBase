import type { LabelReader } from "./label-reader";
import { parseLabel, type LabelLine } from "./parse-label";

// Reading label text with Google Cloud Vision (a Notion decision of
// 2026-09-20: Vision's text detection plus our standard lists). The photos
// go to Vision's `images:annotate` in one request; what comes back is
// every piece of text with where it sits and how sure Vision was. Here
// that becomes lines of text (with how tall each was printed), which
// parseLabel turns into a drink's details.
//
// The key lives in Vercel as GOOGLE_VISION_API_KEY, never in git.

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

// REQ-27 asks for a reading in under about ten seconds; after this the
// review screen opens with nothing read rather than keep anyone waiting.
const TIMEOUT_MS = 9000;

type Vertex = { x?: number; y?: number };
type Break = { type?: "UNKNOWN" | "SPACE" | "SURE_SPACE" | "EOL_SURE_SPACE" | "HYPHEN" | "LINE_BREAK" };
type VisionSymbol = { text?: string; property?: { detectedBreak?: Break } };
type VisionWord = { symbols?: VisionSymbol[]; confidence?: number; boundingBox?: { vertices?: Vertex[] } };
type VisionPage = { blocks?: { paragraphs?: { words?: VisionWord[] }[] }[] };
export type VisionResponse = {
  fullTextAnnotation?: { pages?: VisionPage[] };
  error?: { message?: string };
};

// A word's printed height: the distance between its box's top and bottom
// edges. For text on a slant that's a little more than the letters' true
// height, which is fine for telling big text from small.
function wordHeight(word: VisionWord): number {
  const ys = (word.boundingBox?.vertices ?? []).map((vertex) => vertex.y ?? 0);
  return ys.length === 0 ? 0 : Math.max(...ys) - Math.min(...ys);
}

// Vision's text, split into printed lines. A line ends where Vision saw a
// line break; its height is the average of its words', and its confidence
// the lowest of them, so one doubtful word makes the line doubtful.
export function visionLines(response: VisionResponse, photo: number): LabelLine[] {
  const lines: LabelLine[] = [];
  for (const page of response.fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        let text = "";
        let words: VisionWord[] = [];
        const finish = () => {
          if (text.trim() !== "" && words.length > 0) {
            lines.push({
              text: text.trim(),
              height: words.reduce((sum, word) => sum + wordHeight(word), 0) / words.length,
              confidence: Math.min(...words.map((word) => word.confidence ?? 1)),
              photo,
            });
          }
          text = "";
          words = [];
        };
        for (const word of paragraph.words ?? []) {
          words.push(word);
          for (const symbol of word.symbols ?? []) {
            text += symbol.text ?? "";
            const after = symbol.property?.detectedBreak?.type;
            if (after === "SPACE" || after === "SURE_SPACE") text += " ";
            if (after === "EOL_SURE_SPACE" || after === "LINE_BREAK") finish();
          }
        }
        finish();
      }
    }
  }
  return lines;
}

async function base64(photo: Blob): Promise<string> {
  return Buffer.from(await photo.arrayBuffer()).toString("base64");
}

export function visionReader(apiKey: string, fetchImpl: typeof fetch = fetch): LabelReader {
  return async (photos) => {
    const requests = await Promise.all(
      photos.map(async (photo) => ({
        image: { content: await base64(photo) },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      })),
    );
    const reply = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!reply.ok) throw new Error(`Vision answered ${reply.status}`);
    const { responses = [] } = (await reply.json()) as { responses?: VisionResponse[] };
    const failed = responses.find((response) => response.error?.message);
    if (failed) throw new Error(`Vision: ${failed.error!.message}`);
    return parseLabel(responses.flatMap((response, photo) => visionLines(response, photo)));
  };
}
