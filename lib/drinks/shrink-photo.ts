"use client";

import { PHOTO_EDGE, THUMB_EDGE, encodeUnder, fitWithin } from "./photos";

// Shrinks a photo in the browser before it's sent (REQ-32): the full photo
// to at most PHOTO_EDGE pixels and under the size target, and a small copy
// for the list. A phone photo is several megabytes; what's sent is a few
// hundred kilobytes.
export async function shrinkPhoto(file: Blob): Promise<{ full: Blob; thumb: Blob }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const draw = (edge: number) => {
      const size = fitWithin(bitmap.width, bitmap.height, edge);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
      return (quality: number) =>
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not read the photo"))), "image/jpeg", quality),
        );
    };
    const full = await encodeUnder(draw(PHOTO_EDGE));
    const thumb = await draw(THUMB_EDGE)(0.7);
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}
