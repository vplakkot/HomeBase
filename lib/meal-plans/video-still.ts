"use client";

// REQ-110: a recipe from a video gets a still from it as its photo. The
// browser plays the video silently to a point about a third of the way
// in and copies that frame, or a later one if it comes out black. iPhones
// play their own HEVC videos, so no conversion is needed. If no frame can
// be had, the recipe simply has no photo yet, and either of us can add one.

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

export async function stillFromVideo(file: Blob, timeoutMs = 10_000): Promise<Blob | null> {
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
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) return null;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    // A third of the way in, then later if that frame comes out black (a
    // frame not drawn yet, or a dark shot).
    for (const at of [0.33, 0.5, 0.7]) {
      const seeked = event("seeked");
      video.currentTime = Math.max(0, Math.min(video.duration * at, video.duration - 0.1));
      await seeked;
      await new Promise((resolve) => setTimeout(resolve, 200));
      context.drawImage(video, 0, 0);
      if (!mostlyBlack(context, canvas.width, canvas.height)) {
        return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
