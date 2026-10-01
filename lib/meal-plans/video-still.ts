"use client";

// REQ-156: Gemini watches a recipe's video and names the second where the
// finished dish is shown. Only the phone has the video, so it cuts that
// frame out: the browser plays the file silently to that second and copies
// a small picture of it. This needs the video still open on this phone
// (see lib/meal-plans/kept-video.ts); if it isn't, or the frame comes out
// black, the card simply has no photo. iPhones play their own HEVC videos,
// so no conversion is needed.

// True when a frame is almost all black, judged on a sample of pixels.
export function mostlyBlack(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  const step = Math.max(4, Math.floor(data.length / 4 / 2000) * 4);
  let bright = 0;
  let samples = 0;
  for (let index = 0; index < data.length; index += step) {
    samples += 1;
    if (data[index] + data[index + 1] + data[index + 2] > 60) bright += 1;
  }
  return bright / samples < 0.05;
}

const FRAME_EDGE = 960;

export async function frameAt(file: Blob, seconds: number, timeoutMs = 10_000): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  const event = (name: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${name}`)), timeoutMs);
      video.addEventListener(
        name,
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  try {
    await event("loadeddata");
    if (!video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const seeked = event("seeked");
    video.currentTime = Math.max(0, Math.min(seconds, video.duration - 0.1));
    await seeked;
    await new Promise((resolve) => setTimeout(resolve, 200));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (mostlyBlack(context, canvas.width, canvas.height)) return null;
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
