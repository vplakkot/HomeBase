import { pagesFrom, searchPrompt, suggestionsFrom, type SearchResult } from "./recipe-search";
import { COOKING_METHODS, MAIN_MEATS, draftFrom, type RecipeDraft } from "./recipes";

// Reading recipes with Google's Gemini (REQ-111, REQ-112). Plain web
// requests to Gemini's API, no Google library. The key lives in Vercel
// as GEMINI_API_KEY, never in git, and never leaves the server.
//
// A video is too big to pass through our server (Vercel takes about
// 4.5 MB a request), so the server opens a one-time upload link at Google
// and the phone sends the video straight there. The link carries no key:
// it can receive that one file and nothing else.

const API = "https://generativelanguage.googleapis.com";

// gemini-2.5-flash is closed to new users (tried 2026-09-26); this is
// the model the API pointed to instead.
export const MODEL = "gemini-3.8-flash";

function key(): string {
  const value = process.env.GEMINI_API_KEY;
  if (!value) throw new Error("GEMINI_API_KEY is not set");
  return value;
}

async function call(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  return fetch(API + path, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), "x-goog-api-key": key() },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// Opens a resumable upload at Google for a video of this size and type,
// and returns the link the phone sends it to.
export async function openVideoUpload(size: number, mime: string, displayName: string): Promise<string> {
  const response = await call("/upload/v1beta/files", {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 100) } }),
  });
  const link = response.headers.get("x-goog-upload-url");
  if (!response.ok || !link) throw new Error(`Gemini upload did not start: ${response.status}`);
  return link;
}

// Google's name for an uploaded file. A row's own person can change the
// row directly in the database, so a name read back from one is checked
// against this before it's used with our key.
export function isGeminiFile(name: unknown): name is string {
  return typeof name === "string" && /^files\/[a-z0-9-]+$/i.test(name);
}

export type UploadProgress = { final: true; file: string } | { final: false; received: number };

// How much of a video has reached its upload link, asked from the server.
// A browser can ask this while the upload is going, but not once it's
// complete: Google's answer then lacks the header that lets a browser
// read it (seen 2026-09-26). The server can always read it, and a
// complete upload's answer names the file.
export async function uploadProgress(link: string): Promise<UploadProgress> {
  const response = await fetch(link, {
    method: "POST",
    headers: { "X-Goog-Upload-Command": "query" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Gemini upload check failed: ${response.status}`);
  if (response.headers.get("x-goog-upload-status") === "final") {
    const body = (await response.json()) as { file?: { name?: string } };
    if (!body.file?.name) throw new Error("Gemini didn't name the video");
    return { final: true, file: body.file.name };
  }
  return { final: false, received: Number(response.headers.get("x-goog-upload-size-received") ?? 0) };
}

export type VideoState = { state: "PROCESSING" | "ACTIVE" | "FAILED" | "UNKNOWN"; uri?: string; mimeType?: string };

// Where Google is with an uploaded video. Google's status check sometimes
// answers 500 while a video is processing (seen 2026-09-26); that counts
// as "not yet" rather than a failure.
export async function videoState(name: string): Promise<VideoState> {
  const response = await call(`/v1beta/${name}`, {}, 15_000);
  if (response.status >= 500) return { state: "UNKNOWN" };
  if (!response.ok) throw new Error(`Gemini status check failed: ${response.status}`);
  const file = (await response.json()) as { state?: string; uri?: string; mimeType?: string };
  const state = file.state === "ACTIVE" || file.state === "FAILED" || file.state === "PROCESSING" ? file.state : "UNKNOWN";
  return { state, uri: file.uri, mimeType: file.mimeType };
}

// REQ-112: the video is discarded once it's been read. Google would drop
// it after 48 hours anyway; this doesn't wait for that.
export async function deleteVideo(name: string): Promise<void> {
  await call(`/v1beta/${name}`, { method: "DELETE" }, 15_000).catch(() => undefined);
}

// The recipe card's layout (REQ-110), as Gemini must answer it.
export const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "False if there is no recipe to read." },
    name: { type: "string" },
    cuisine: { type: "string", description: "One word or two, e.g. Italian, Turkish, Indian." },
    main_meat: { type: "string", enum: [...MAIN_MEATS] },
    cooking_method: { type: "string", enum: [...COOKING_METHODS] },
    cook_minutes: { type: "integer" },
    servings: { type: "integer" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quantity: { type: "string" },
          unit: { type: "string" },
          item: { type: "string" },
          note: { type: "string" },
        },
        required: ["item"],
      },
    },
    steps: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
    guessed: {
      type: "array",
      items: { type: "string", enum: ["cuisine", "main_meat", "cooking_method", "cook_minutes", "servings"] },
    },
  },
  required: ["found", "ingredients", "steps", "guessed"],
};

// The rules every card follows (REQ-110), whatever the source.
export const CARD_RULES = `Write one recipe card.
- Every step that uses an ingredient states its quantity in the step itself: "Add 1 tsp cumin", "Add the remaining 1 tsp cumin". Never just "the cumin" or "the remaining".
- main_meat is one value: the main one if the dish has two. Vegetarian if there is none.
- cooking_method is exactly one of: Stove top, Air fryer, Instant Pot, Oven. A dish that works in both the oven and an air fryer is Air fryer.
- Keep quantities exactly as given. If a quantity is never stated, leave it empty; never make one up.
- For cuisine, main_meat, cooking_method, cook_minutes and servings: if the source doesn't say, give your best estimate and list the field in "guessed".
- Steps are short imperative sentences, in order, without numbers.
- If there is no recipe to read, answer {"found": false, "ingredients": [], "steps": [], "guessed": []}. Never invent a recipe in its place.`;

export function videoPrompt(name: string): string {
  const which = name ? ` for "${name}"` : "";
  const naming = name ? "" : " For name, give the dish's own name as the video calls it or shows it.";
  return `${CARD_RULES}
Read the recipe${which} from this cooking video only: what is shown, said aloud, and written on screen. Don't add anything the video doesn't show or say.${naming}`;
}

export function textPrompt(name: string, recipe: string): string {
  return `${CARD_RULES}
The recipe${name ? ` for "${name}"` : ""}, as we have it (anything from a full recipe to rough notes):
"""
${recipe}
"""`;
}

// REQ-112: a card from the one recipe page we picked, and nothing else.
// REQ-150: a pasted link comes with no name, so the page gives it.
export function pagePrompt(name: string, page: string): string {
  const which = name ? ` for "${name}"` : "";
  const naming = name ? "" : " For name, give the recipe's own title as the page gives it.";
  return `${CARD_RULES}
Read the recipe${which} from this web page only. Don't add anything the page doesn't say. If the page has no recipe, say so as above.${naming}
"""
${page}
"""`;
}

// REQ-112: the one time Gemini may write a recipe of its own, when asked
// to for a card saved as "Recipe missing". The card is then marked
// "AI-generated" until either of us edits it.
export function genericPrompt(name: string): string {
  return `${CARD_RULES.replace(/\n- If there is no recipe to read[^\n]*/, "")}
Write a typical home version of "${name}", as a well-known cookbook would give it, with real quantities. Keep it simple enough for a weeknight.`;
}

type Part = { text: string } | { file_data: { mime_type: string; file_uri: string } } | { inline_data: { mime_type: string; data: string } };

export type Reading = { draft: RecipeDraft } | { error: string };

async function generate(parts: Part[], timeoutMs: number, schema: object = RECIPE_SCHEMA): Promise<Response | { error: string }> {
  const response = await call(
    `/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          // REQ-112: small on-screen quantities need the sharper frames.
          mediaResolution: "MEDIA_RESOLUTION_HIGH",
        },
      }),
    },
    timeoutMs,
  );
  return response.ok ? response : { error: `Gemini answered ${response.status}.` };
}

async function read(parts: Part[], timeoutMs: number): Promise<Reading> {
  const response = await generate(parts, timeoutMs);
  return response instanceof Response ? readingFrom(await response.json()) : response;
}

// Gemini's reply, turned into a draft. Its thinking comes back as parts
// marked `thought`; only the answer counts.
export function readingFrom(reply: unknown): Reading {
  const parsed = answerFrom(reply);
  if (parsed === undefined) return { error: "Gemini's answer couldn't be read." };
  const draft = draftFrom(parsed);
  return draft ? { draft } : { error: "Gemini found no recipe in it." };
}

function answerFrom(reply: unknown): unknown {
  const parts = (reply as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
  const answer = parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");
  try {
    return JSON.parse(answer);
  } catch {
    return undefined;
  }
}

export async function recipeFromVideo(name: string, file: { uri: string; mimeType: string }): Promise<Reading> {
  return read([{ file_data: { mime_type: file.mimeType, file_uri: file.uri } }, { text: videoPrompt(name) }], 240_000);
}

// REQ-157: a recipe from pictures (a carousel, screenshots). The pictures
// are numbered so Gemini can name the one that could be the card's photo:
// the one showing the finished dish, or none (0). A person in it doesn't
// matter here (Vin, 2026-10-01); that rule is for video frames (REQ-156).
export const IMAGES_SCHEMA = {
  ...RECIPE_SCHEMA,
  properties: {
    ...RECIPE_SCHEMA.properties,
    photo_image: {
      type: "integer",
      description: "The number of the one image that shows the finished dish as a photo; 0 if none does. Never a screenshot of text.",
    },
  },
};

export function imagesPrompt(count: number): string {
  return `${CARD_RULES}
Read the recipe from these ${count} image${count === 1 ? "" : "s"} only: what is written on them and what they show. Together they are one recipe, in any order (a carousel, or a recipe split across screenshots). Don't add anything they don't show or say. For name, give the dish's own name as the images call it or show it.
Also give photo_image.`;
}

export type ImageFile = { mime: string; data: string };
export type ImagesReading = { draft: RecipeDraft; photo: number | null } | { error: string };

// `data` is each image's bytes in base64; nothing is stored at Google.
export async function recipeFromImages(images: ImageFile[]): Promise<ImagesReading> {
  const parts: Part[] = images.flatMap((image, index): Part[] => [
    { text: `Image ${index + 1}:` },
    { inline_data: { mime_type: image.mime, data: image.data } },
  ]);
  parts.push({ text: imagesPrompt(images.length) });
  const response = await generate(parts, 120_000, IMAGES_SCHEMA);
  if (!(response instanceof Response)) return response;
  const reply = await response.json();
  const reading = readingFrom(reply);
  if ("error" in reading) return reading;
  const picked = (answerFrom(reply) as { photo_image?: unknown })?.photo_image;
  const photo = Number.isInteger(picked) && (picked as number) >= 1 && (picked as number) <= images.length ? (picked as number) - 1 : null;
  return { draft: reading.draft, photo };
}

// REQ-156: which frames of a cooking video could be the card's photo. The
// phone takes a few from near the start and a few from near the end, in
// that order; Gemini names up to three that show the finished dish with no
// part of a person in it, best first. None is a fine answer.
export const FRAMES_SCHEMA = {
  type: "object",
  properties: {
    frames: { type: "array", items: { type: "integer" }, description: "Frame numbers, best first. Empty if no frame qualifies." },
  },
  required: ["frames"],
};

export function framesPrompt(count: number): string {
  return `These ${count} frames come from one cooking video, in order: the first half from near its start, the rest from near its end, where creators usually show the finished dish.
Pick up to 3 frames that show the finished, plated dish clearly as the main subject, as a photo for its recipe card. Never pick a frame with any part of a person in it (face, hands, arms, body), a dish still being made, loose ingredients, or text. Best first. If no frame qualifies, answer an empty list.`;
}

export async function pickDishFrames(images: ImageFile[]): Promise<number[]> {
  const parts: Part[] = images.flatMap((image, index): Part[] => [
    { text: `Frame ${index + 1}:` },
    { inline_data: { mime_type: image.mime, data: image.data } },
  ]);
  parts.push({ text: framesPrompt(images.length) });
  const response = await generate(parts, 60_000, FRAMES_SCHEMA);
  if (!(response instanceof Response)) throw new Error(response.error);
  const picked = (answerFrom(await response.json()) as { frames?: unknown })?.frames;
  if (!Array.isArray(picked)) return [];
  const valid = picked.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= images.length);
  return [...new Set(valid)].slice(0, 3).map((n) => n - 1);
}

export async function recipeFromText(name: string, recipe: string): Promise<Reading> {
  return read([{ text: textPrompt(name, recipe) }], 90_000);
}

export async function recipeFromPage(name: string, page: string): Promise<Reading> {
  return read([{ text: pagePrompt(name, page) }], 90_000);
}

export async function genericRecipe(name: string): Promise<Reading> {
  return read([{ text: genericPrompt(name) }], 90_000);
}

// REQ-112: recipe pages for a dish, from Gemini's Google Search. Only the
// pages Google found count; what Gemini writes about them is ignored.
export async function searchRecipePages(name: string, fetchImpl: typeof fetch = fetch): Promise<SearchResult | { error: string }> {
  const response = await call(
    `/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: searchPrompt(name) }] }], tools: [{ google_search: {} }] }),
    },
    60_000,
  );
  if (!response.ok) return { error: `Gemini answered ${response.status}.` };
  const reply = await response.json();
  return { pages: await pagesFrom(reply, fetchImpl), suggestions: suggestionsFrom(reply) };
}
