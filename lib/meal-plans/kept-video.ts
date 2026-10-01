// REQ-156: the video a phone just sent, kept in this tab's memory until its
// recipe has been read, so the frame Gemini chose can be cut out of it.
// Nothing else has the file: Google doesn't give it back, and our server
// never held it. Closing or reloading HomeBase loses it, and that card gets
// no photo.

const kept = new Map<string, Blob>();

export function keepVideo(importId: string, file: Blob): void {
  kept.set(importId, file);
}

// The video for an import, handed over once (and forgotten).
export function takeVideo(importId: string): Blob | undefined {
  const file = kept.get(importId);
  kept.delete(importId);
  return file;
}

export function hasVideo(importId: string): boolean {
  return kept.has(importId);
}

export function dropVideo(importId: string): void {
  kept.delete(importId);
}
