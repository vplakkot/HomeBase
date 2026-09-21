import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../test/css";
import { readPng } from "../test/png";
import { metadata } from "./layout";
import manifest from "./manifest";

const PUBLIC_DIR = join(REPO_ROOT, "public");
const DESIGN_ICON = join(REPO_ROOT, "docs", "design", "icon.svg");

// The icon's background colour, as the design's own file gives it: the
// fill of the full-size square every other shape sits on.
const background = (() => {
  const svg = readFileSync(DESIGN_ICON, "utf-8");
  const hex = svg.match(/<rect width="64" height="64"[^>]*fill="#([0-9A-Fa-f]{6})"/)?.[1];
  if (!hex) throw new Error("no background square in docs/design/icon.svg");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
})();

function sizeOf(publicPath: string): { width: number; height: number } {
  const { width, height } = readPng(join(PUBLIC_DIR, publicPath));
  return { width, height };
}

// DESIGN.md asks for home-screen icons exported square, because iPhones
// round the corners themselves. A rounded export shows up in the top
// corners: see-through there, or a colour other than the background.
function expectSquareDesignIcon(publicPath: string) {
  const png = readPng(join(PUBLIC_DIR, publicPath));
  expect(png.hasAlpha, `${publicPath} has a transparency channel`).toBe(false);
  expect(png.topRow[0].slice(0, 3), `${publicPath} top-left`).toEqual(background);
  expect(png.topRow[png.width - 1].slice(0, 3), `${publicPath} top-right`).toEqual(background);
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
      expect(sizeOf(icon.src)).toEqual({ width, height });
    }
  });

  it("uses the design's icon, square and solid to the corners", () => {
    for (const icon of card.icons ?? []) expectSquareDesignIcon(icon.src);
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
    expect(sizeOf(apple)).toEqual({ width: 180, height: 180 });
  });

  it("uses the design's icon there too, square and solid to the corners", () => {
    const { apple } = metadata.icons as { apple: string };
    expectSquareDesignIcon(apple);
  });
});

// A browser check confirmed Next.js turns these into links on every page.
describe("what a browser tab shows", () => {
  const { icon } = metadata.icons as { icon: Array<Record<string, string>> };

  it("is the design's icon file, unchanged", () => {
    expect(icon).toContainEqual({ url: "/icon.svg", type: "image/svg+xml" });
    expect(readFileSync(join(PUBLIC_DIR, "icon.svg"))).toEqual(readFileSync(DESIGN_ICON));
  });

  it("has a fallback for browsers that can't show SVG, at 16, 32 and 48 pixels", () => {
    expect(icon).toContainEqual({ url: "/favicon.ico", sizes: "16x16 32x32 48x48" });
    const ico = readFileSync(join(PUBLIC_DIR, "favicon.ico"));
    expect(ico.readUInt16LE(0), "reserved, always 0").toBe(0);
    expect(ico.readUInt16LE(2), "1 means an icon file").toBe(1);
    // A 16-byte entry per picture, the first byte of each being its width.
    const count = ico.readUInt16LE(4);
    const widths = Array.from({ length: count }, (_, i) => ico[6 + i * 16]);
    expect(widths).toEqual([16, 32, 48]);
  });
});
