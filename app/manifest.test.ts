import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "./layout";
import manifest from "./manifest";

const PUBLIC_DIR = join(__dirname, "..", "public");

// A PNG's width and height sit at bytes 16–23: after the 8-byte signature
// and the first chunk's length and name ("IHDR"). Reading them directly
// proves the file on disk is the size the card claims.
function pngSize(publicPath: string): { width: number; height: number } {
  const bytes = readFileSync(join(PUBLIC_DIR, publicPath));
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the app card a phone reads on Add to Home Screen", () => {
  const card = manifest();

  it("names the app HomeBase", () => {
    expect(card.name).toBe("HomeBase");
    expect(card.short_name).toBe("HomeBase");
  });

  it("opens full screen, without the browser's address bar", () => {
    expect(card.display).toBe("standalone");
  });

  it("starts on the home page", () => {
    expect(card.start_url).toBe("/");
  });

  it("offers the 192 and 512 pixel icons phones ask for", () => {
    expect(card.icons?.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
  });

  it("names only icons that exist, at the sizes it claims", () => {
    for (const icon of card.icons ?? []) {
      const [width, height] = (icon.sizes ?? "").split("x").map(Number);
      expect(pngSize(icon.src)).toEqual({ width, height });
    }
  });
});

describe("what every page tells an iPhone", () => {
  it("names the home-screen icon HomeBase", () => {
    expect(metadata.appleWebApp).toMatchObject({
      capable: true,
      title: "HomeBase",
    });
  });

  it("points to a 180 pixel home-screen icon that exists", () => {
    const { apple } = metadata.icons as { apple: string };
    expect(pngSize(apple)).toEqual({ width: 180, height: 180 });
  });
});
