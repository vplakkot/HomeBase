import type { SupabaseClient } from "@supabase/supabase-js";

// Label photos (REQ-32) live in a private Storage bucket. The drink row
// keeps each photo's path; its small copy for the list sits beside it.

export const LABEL_BUCKET = "drink-labels";

// The target the requirement sets: well under 500 KB a photo.
export const MAX_PHOTO_BYTES = 450_000;
// The long side, in pixels: sharp enough to read a label, small enough to
// stay under the target.
export const PHOTO_EDGE = 1600;
export const THUMB_EDGE = 240;

export type Side = "front" | "back";

// "d1/1759000000000-front.jpg" → "d1/1759000000000-front-thumb.jpg"
export function thumbPath(path: string): string {
  return path.replace(/\.jpg$/, "-thumb.jpg");
}

// A new name each time, so a replaced photo never shows an old cached one.
export function photoPath(drinkId: string, side: Side, now = Date.now()): string {
  return `${drinkId}/${now}-${side}.jpg`;
}

// The size to draw a photo at: the long side at most `edge`, never larger
// than it was.
export function fitWithin(width: number, height: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Encodes at falling quality until the photo is under the limit (REQ-32).
// `encode` turns a quality (0 to 1) into a JPEG; the browser's canvas
// does that, and a test can stand in for it.
export async function encodeUnder(
  encode: (quality: number) => Promise<Blob>,
  limit = MAX_PHOTO_BYTES,
): Promise<Blob> {
  let blob: Blob | null = null;
  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42, 0.32]) {
    blob = await encode(quality);
    if (blob.size <= limit) return blob;
  }
  return blob!;
}

// Short-lived links to the photos, made on the server for members only.
// Returns path → link; a photo whose link can't be made is left out and
// the page shows no picture for it.
export async function signedPhotoLinks(
  supabase: SupabaseClient,
  paths: readonly string[],
  seconds = 60 * 60,
): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (paths.length === 0) return links;
  const { data, error } = await supabase.storage.from(LABEL_BUCKET).createSignedUrls([...paths], seconds);
  if (error || !data) return links;
  for (const row of data) if (row.path && row.signedUrl && !row.error) links.set(row.path, row.signedUrl);
  return links;
}
