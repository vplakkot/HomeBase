import { describe, expect, it, vi } from "vitest";
import { readTokens } from "../test/css";

// Which fonts the app asks next/font for, and whether each one is
// published under the variable tokens.css actually reads. That link is
// the one that fails silently: rename either side alone and the page
// still renders, without the resized stand-in font, and nothing says so.

// Each font call's options, by font. A plain list rather than vi.fn():
// Vitest wipes a mock's call history before every test, and these calls
// happen once, when fonts.ts is first imported.
const calls = vi.hoisted(() => new Map<string, Record<string, unknown>[]>());
// vitest.config.ts already swaps next/font/google for this stand-in, so
// that's the module to replace with loaders that note what they're asked.
vi.mock("../test/next-font-google", () => {
  const loader = (family: string) => (options: Record<string, unknown>) => {
    calls.set(family, [...(calls.get(family) ?? []), options]);
    return { className: "", variable: "", style: { fontFamily: "" } };
  };
  return {
    Bricolage_Grotesque: loader("Bricolage_Grotesque"),
    Plus_Jakarta_Sans: loader("Plus_Jakarta_Sans"),
  };
});

import "./fonts";

const tokens = readTokens();

// "var(--font-face-display, 'Bricolage Grotesque'), system-ui, sans-serif"
// reads --font-face-display.
function variableReadBy(token: string): string | undefined {
  return tokens.get(token)?.match(/^var\((--[\w-]+)/)?.[1];
}

function optionsFor(family: string): Record<string, unknown> {
  expect(calls.get(family), `${family} loaded once`).toHaveLength(1);
  return calls.get(family)![0];
}

describe("the display font", () => {
  it("is Bricolage Grotesque with its optical-size axis, as the mockups were drawn", () => {
    expect(optionsFor("Bricolage_Grotesque")).toMatchObject({
      subsets: ["latin"],
      axes: ["opsz"],
    });
  });

  it("is published under the variable --font-display reads", () => {
    const variable = variableReadBy("--font-display");
    expect(variable).toBeDefined();
    expect(optionsFor("Bricolage_Grotesque").variable).toBe(variable);
  });
});

describe("the body font", () => {
  it("is Plus Jakarta Sans", () => {
    expect(optionsFor("Plus_Jakarta_Sans")).toMatchObject({ subsets: ["latin"] });
  });

  it("is published under the variable --font-body reads", () => {
    const variable = variableReadBy("--font-body");
    expect(variable).toBeDefined();
    expect(optionsFor("Plus_Jakarta_Sans").variable).toBe(variable);
  });
});

describe("before the font files arrive", () => {
  it("falls back to the system font", () => {
    expect(tokens.get("--font-display")).toMatch(/, system-ui, sans-serif$/);
    expect(tokens.get("--font-body")).toMatch(/, system-ui, sans-serif$/);
  });
});
