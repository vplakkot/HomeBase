import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteVideo, isGeminiFile, recipeFromImages, recipeFromVideo, videoState, type ImageFile, type VideoState } from "./gemini";
import { UNNAMED_IMAGES, UNNAMED_RECIPE } from "./video-types";

// Reading an uploaded video, after the phone has finished sending it
// (REQ-112, BETA). It runs on the server once the request that started it
// has answered, so nobody waits on a screen: the phone moves on and the
// "Recipe ready" toast finds the result. The import row records each
// step, and whatever happens the video at Google is deleted at the end.

const POLL_MS = 3000;
// Google usually has a short clip ready within seconds; after this the
// import fails rather than hang.
const READY_WITHIN_MS = 150_000;

// A row still processing this long after its upload finished was lost
// (the server stopped before finishing); one still uploading this long was
// abandoned. Both become failures the person can dismiss or try again.
export const PROCESSING_GIVES_UP_MS = 10 * 60_000;
export const UPLOAD_GIVES_UP_MS = 2 * 60 * 60_000;

type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntilReady(
  name: string,
  check: (name: string) => Promise<VideoState> = videoState,
  wait: Wait = sleep,
  limitMs = READY_WITHIN_MS,
): Promise<VideoState | { error: string }> {
  for (let waited = 0; waited <= limitMs; waited += POLL_MS) {
    const state = await check(name).catch((): VideoState => ({ state: "UNKNOWN" }));
    if (state.state === "ACTIVE" && state.uri) return state;
    if (state.state === "FAILED") return { error: "Google couldn't process the video." };
    await wait(POLL_MS);
  }
  return { error: "Google took too long to process the video." };
}

export async function processVideoImport(
  admin: SupabaseClient,
  importId: string,
  deps: { wait?: Wait; check?: typeof videoState; read?: typeof recipeFromVideo; discard?: typeof deleteVideo } = {},
): Promise<void> {
  const { data: row } = await admin
    .from("recipe_imports")
    .select("id, name, gemini_file, status")
    .eq("id", importId)
    .maybeSingle();
  if (!row || row.status !== "processing" || !isGeminiFile(row.gemini_file)) return;
  const file: string = row.gemini_file;
  const finish = (fields: Record<string, unknown>) =>
    admin
      .from("recipe_imports")
      .update({ ...fields, gemini_file: null, updated_at: new Date().toISOString() })
      .eq("id", importId)
      // Removed or given up on meanwhile: leave it be.
      .eq("status", "processing");
  try {
    const ready = await waitUntilReady(file, deps.check, deps.wait);
    if ("error" in ready) {
      await finish({ status: "failed", error: ready.error });
      return;
    }
    // A video sent without a name is read for its own: Gemini names it.
    const unnamed = row.name === UNNAMED_RECIPE;
    const reading = await (deps.read ?? recipeFromVideo)(unnamed ? "" : row.name, { uri: ready.uri!, mimeType: ready.mimeType ?? "video/mp4" });
    if ("error" in reading) await finish({ status: "failed", error: reading.error });
    else await finish({ status: "ready", draft: reading.draft, error: null, ...(unnamed && reading.draft.name ? { name: reading.draft.name } : {}) });
  } catch (error) {
    await finish({ status: "failed", error: error instanceof Error ? error.message : "Something went wrong." });
  } finally {
    await (deps.discard ?? deleteVideo)(file);
  }
}

// Reading pictures (REQ-157): they came with the request, so there is no
// upload to wait for and nothing at Google to delete; they are simply not
// kept. `keepPhoto` stores the picture Gemini picked as the draft's photo
// and returns its path; a photo that can't be kept just leaves the card
// without one.
export async function processImageImport(
  admin: SupabaseClient,
  importId: string,
  images: ImageFile[],
  deps: { read?: typeof recipeFromImages; keepPhoto?: (index: number) => Promise<string | null> } = {},
): Promise<void> {
  const { data: row } = await admin.from("recipe_imports").select("id, name, status").eq("id", importId).maybeSingle();
  if (!row || row.status !== "processing") return;
  const finish = (fields: Record<string, unknown>) =>
    admin
      .from("recipe_imports")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", importId)
      .eq("status", "processing");
  try {
    const reading = await (deps.read ?? recipeFromImages)(images);
    if ("error" in reading) {
      await finish({ status: "failed", error: reading.error });
      return;
    }
    const photo = reading.photo === null || !deps.keepPhoto ? null : await deps.keepPhoto(reading.photo).catch(() => null);
    const unnamed = row.name === UNNAMED_IMAGES;
    await finish({
      status: "ready",
      draft: reading.draft,
      error: null,
      ...(photo ? { photo } : {}),
      ...(unnamed && reading.draft.name ? { name: reading.draft.name } : {}),
    });
  } catch (error) {
    await finish({ status: "failed", error: error instanceof Error ? error.message : "Something went wrong." });
  }
}
