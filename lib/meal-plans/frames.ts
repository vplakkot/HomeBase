import type { SupabaseClient } from "@supabase/supabase-js";
import { thumbPath } from "../drinks/photos";
import { pickDishFrames, type ImageFile } from "./gemini";
import { RECIPE_PHOTOS } from "./photos";

// REQ-156: candidate photos for a recipe read from a video. The phone sends
// a few frames, Gemini names the ones showing the finished dish with no
// person in them, and those are kept beside the draft until one is chosen
// at review (or the draft is removed). They live in the recipe-photos
// bucket as imports/<id>/frames/<n>.jpg, n from 1, with their small copy.

export const framesFolder = (importId: string) => `imports/${importId}/frames`;
export const framePath = (importId: string, n: number) => `${framesFolder(importId)}/${n}.jpg`;

export async function keepDishFrames(
  admin: SupabaseClient,
  importId: string,
  frames: readonly Blob[],
  deps: { pick?: typeof pickDishFrames } = {},
): Promise<number> {
  const images: ImageFile[] = await Promise.all(
    frames.map(async (frame) => ({ mime: "image/jpeg", data: Buffer.from(await frame.arrayBuffer()).toString("base64") })),
  );
  const picked = await (deps.pick ?? pickDishFrames)(images);
  const bucket = admin.storage.from(RECIPE_PHOTOS);
  for (const [position, index] of picked.entries()) {
    const path = framePath(importId, position + 1);
    for (const where of [path, thumbPath(path)]) {
      const { error } = await bucket.upload(where, frames[index], { contentType: "image/jpeg" });
      if (error) throw new Error(`Could not keep a frame: ${error.message}`);
    }
  }
  return picked.length;
}

// The candidates a draft has, as numbers (1, 2, 3).
export async function readFrames(supabase: SupabaseClient, importId: string): Promise<number[]> {
  const { data } = await supabase.storage.from(RECIPE_PHOTOS).list(framesFolder(importId));
  return (data ?? [])
    .map((file) => /^(\d+)\.jpg$/.exec(file.name)?.[1])
    .flatMap((n) => (n ? [Number(n)] : []))
    .sort((a, b) => a - b);
}

export async function removeFrames(supabase: SupabaseClient, importId: string): Promise<void> {
  const numbers = await readFrames(supabase, importId);
  const paths = numbers.flatMap((n) => [framePath(importId, n), thumbPath(framePath(importId, n))]);
  if (paths.length > 0) await supabase.storage.from(RECIPE_PHOTOS).remove(paths);
}
