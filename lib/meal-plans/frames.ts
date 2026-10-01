import type { SupabaseClient } from "@supabase/supabase-js";
import { thumbPath } from "../drinks/photos";
import { RECIPE_PHOTOS } from "./photos";

// REQ-156: the candidate photo for a recipe read from a video. Gemini names
// the second; the phone that still has the video cuts the frame and sends
// it. It's kept beside the draft until the draft is saved (it becomes the
// card's photo) or removed. It lives in the recipe-photos bucket as
// imports/<id>/frames/1.jpg, with its small copy.

export const framesFolder = (importId: string) => `imports/${importId}/frames`;
export const framePath = (importId: string, n: number) => `${framesFolder(importId)}/${n}.jpg`;

// The candidates a draft has, as numbers (today only 1).
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
