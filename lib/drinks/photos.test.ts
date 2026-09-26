import { describe, expect, it, vi } from "vitest";
import { MAX_PHOTO_BYTES, encodeUnder, fitWithin, photoPath, thumbPath } from "./photos";

describe("label photos (REQ-32)", () => {
  it("shrinks a phone photo so its long side is at most the edge, and never enlarges", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("lowers the quality until the photo is under the size target", async () => {
    // An invented encoder: the lower the quality, the smaller the file.
    const encode = vi.fn(async (quality: number) => new Blob([new Uint8Array(Math.round(quality * 800_000))]));
    const blob = await encodeUnder(encode);
    expect(blob.size).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    expect(encode.mock.calls.map(([quality]) => quality)).toEqual([0.82, 0.72, 0.62, 0.52]);
  });

  it("stops at the first quality that fits", async () => {
    const encode = vi.fn(async () => new Blob([new Uint8Array(200_000)]));
    await encodeUnder(encode);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("names each photo afresh under its drink, with its small copy beside it", () => {
    expect(photoPath("d1", "front", 1759000000000)).toBe("d1/1759000000000-front.jpg");
    expect(thumbPath("d1/1759000000000-back.jpg")).toBe("d1/1759000000000-back-thumb.jpg");
  });
});
