"use client";

import { setDraftFrame } from "../../app/meal-plans/actions";
import { dropVideo, hasVideo, keptIds, takeVideo } from "./kept-video";
import type { RecipeImport } from "./recipes";
import { currentUploads } from "./video-upload";
import { frameAt } from "./video-still";

// REQ-156: for each recipe that has just been read, cuts out the frame
// Gemini chose, from the video this tab kept, and sends it to wait beside
// the draft. Whatever goes wrong, the draft is simply without a photo.
// A video that isn't needed any more (the read failed, or no moment
// qualified) is let go, and so is one whose draft was removed meanwhile
// (no longer among `items`, and not still being sent from this tab).
export async function cutDraftPhotos(
  items: readonly Pick<RecipeImport, "id" | "status" | "photo_at">[],
  deps: { cut?: typeof frameAt; send?: typeof setDraftFrame } = {},
): Promise<void> {
  const sending = new Set(currentUploads().map((upload) => upload.id));
  const known = new Set(items.map((item) => item.id));
  for (const id of keptIds()) if (!known.has(id) && !sending.has(id)) dropVideo(id);
  for (const item of items) {
    if (!hasVideo(item.id) || item.status === "uploading" || item.status === "processing") continue;
    const video = takeVideo(item.id);
    if (!video || item.status !== "ready" || item.photo_at === null) continue;
    try {
      const frame = await (deps.cut ?? frameAt)(video, item.photo_at);
      if (!frame) continue;
      const data = new FormData();
      data.set("import_id", item.id);
      data.set("frame", frame, "frame.jpg");
      await (deps.send ?? setDraftFrame)(data);
    } catch {
      // No photo; either of us can add one after saving.
    }
  }
}
