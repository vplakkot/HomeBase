"use client";

// REQ-156: a recipe from a video may get one of its frames as its photo.
// Before the video is sent, the browser plays it silently to a few points
// near its start and a few near its end (where creators show the finished
// dish) and copies a small picture of each, skipping any that come out
// black. Gemini then names the ones that qualify. This happens while the
// button says "Starting…", a few seconds, so the phone needn't stay on
// screen afterwards. iPhones play their own HEVC videos, so no conversion
// is needed. If no frame can be had, the card simply has no photo.

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

// Where in the video to look, as fractions of its length: first the
// start, then the end.
export const FRAME_POINTS = [0.03, 0.08, 0.13, 0.18, 0.82, 0.87, 0.92, 0.97];
const FRAME_EDGE = 960;

export async function sampleFrames(file: Blob, points: readonly number[] = FRAME_POINTS, timeoutMs = 10_000): Promise<Blob[]> {
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
  const frames: Blob[] = [];
  try {
    await event("loadeddata");
    if (!video.videoWidth || !video.videoHeight) return [];
    const scale = Math.min(1, FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    for (const at of points) {
      const seeked = event("seeked");
      video.currentTime = Math.max(0, Math.min(video.duration * at, video.duration - 0.1));
      await seeked;
      await new Promise((resolve) => setTimeout(resolve, 200));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (mostlyBlack(context, canvas.width, canvas.height)) continue;
      const frame = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
      if (frame) frames.push(frame);
    }
    return frames;
  } catch {
    // Whatever was taken before it stopped is still good.
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
