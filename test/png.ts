import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

// Just enough PNG reading for tests to check an icon: its size, whether it
// has a transparency channel, and the colour of each pixel along its top
// row, which is where rounded corners would show. It reads the plain 8-bit
// RGB and RGBA files scripts/export-icons.sh writes, and refuses others.

export type Png = {
  width: number;
  height: number;
  hasAlpha: boolean;
  // [red, green, blue] or [red, green, blue, alpha], 0–255, left to right.
  topRow: number[][];
};

export function readPng(path: string): Png {
  const bytes = readFileSync(path);
  if (bytes.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error(`${path} is not a PNG`);
  }
  // The header chunk comes first: size, then how pixels are stored.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const [bitDepth, colourType, , , interlace] = bytes.subarray(24, 29);
  if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6) || interlace !== 0) {
    throw new Error(`${path}: only plain 8-bit RGB or RGBA PNGs are read here`);
  }
  const channels = colourType === 6 ? 4 : 3;

  // The pixels are compressed across one or more IDAT chunks.
  const compressed: Buffer[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.subarray(offset + 4, offset + 8).toString("ascii") === "IDAT") {
      compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(compressed));

  // Each row starts with a filter byte saying how its bytes were encoded
  // relative to their neighbours. The top row has nothing above it, so
  // every filter reduces to "plus some share of the byte to the left".
  const filter = rows[0];
  const encoded = rows.subarray(1, 1 + width * channels);
  const decoded = Buffer.alloc(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    const left = i >= channels ? decoded[i - channels] : 0;
    const predicted = [0, left, 0, left >> 1, left][filter];
    if (predicted === undefined) throw new Error(`${path}: unknown PNG filter ${filter}`);
    decoded[i] = (encoded[i] + predicted) & 0xff;
  }

  const topRow: number[][] = [];
  for (let x = 0; x < width; x++) {
    topRow.push([...decoded.subarray(x * channels, (x + 1) * channels)]);
  }
  return { width, height, hasAlpha: channels === 4, topRow };
}
