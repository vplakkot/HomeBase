// REQ-122: the header's Scan opens the camera on the page you're on, so
// the photo is taken before the scan screen exists. It waits here, in
// the browser's memory, for the scan screen to pick it up. A plain value
// is enough: moving between Next.js pages keeps the same scripts running.
export type Source = "camera" | "library";

let pending: { file: File; source: Source } | null = null;

export function holdPhoto(file: File, source: Source) {
  pending = { file, source };
}

export function heldPhoto() {
  return pending;
}

export function releasePhoto() {
  pending = null;
}
