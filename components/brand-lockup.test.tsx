// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLockup } from "./brand-lockup";

describe("the brand lockup", () => {
  afterEach(cleanup);

  it("shows the HomeBase mark at 30 pixels, then the name", () => {
    const { container } = render(<BrandLockup />);
    const mark = container.querySelector("img");
    expect(mark?.getAttribute("src")).toBe("/icon.svg");
    expect(mark?.getAttribute("width")).toBe("30");
    expect(mark?.getAttribute("height")).toBe("30");
    expect(container.textContent).toBe("HomeBase");
  });

  // An empty description is how a picture says "decoration": a screen
  // reader reads "HomeBase" once, rather than the picture and then the name.
  it("lets a screen reader skip the mark, since the name says it", () => {
    const { container } = render(<BrandLockup />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });
});
