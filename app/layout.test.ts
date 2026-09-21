import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// The root layout wraps every page in the app, so whatever it loads is
// available everywhere. That is what makes the tokens app-wide.

const loaded = vi.hoisted(() => [] as string[]);
vi.mock("../docs/design/tokens.css", () => {
  loaded.push("tokens");
  return {};
});
vi.mock("./globals.css", () => {
  loaded.push("base styles");
  return {};
});

import { bodyFont, displayFont } from "./fonts";
import RootLayout from "./layout";

describe("the root layout, which wraps every page", () => {
  it("loads the design tokens and the base styles built from them", () => {
    expect(loaded).toEqual(expect.arrayContaining(["tokens", "base styles"]));
  });

  // Checked in a browser: with these on <body> instead, both font tokens
  // fell back to the bare names in tokens.css and lost the resized
  // stand-in font that stops text jumping while the fonts load.
  it("puts both fonts' variables on <html>, the :root tokens.css reads them from", () => {
    const html = RootLayout({ children: null }) as ReactElement<{ className: string }>;
    expect(html.type).toBe("html");
    const classes = html.props.className.split(" ");
    for (const font of [displayFont, bodyFont]) {
      expect(font.variable).not.toBe("");
      expect(classes).toContain(font.variable);
    }
  });
});
