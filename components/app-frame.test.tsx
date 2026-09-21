// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppFrame } from "./app-frame";

afterEach(cleanup);

describe("the app frame", () => {
  it("puts the page in the main area, beside the sidebar", () => {
    render(
      <AppFrame current="home" canAdminister={false}>
        <p>The page</p>
      </AppFrame>,
    );
    expect(screen.getByRole("main").textContent).toBe("The page");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeDefined();
  });

  it("puts a phone bar below the main area, outside it, so it doesn't scroll away", () => {
    render(
      <AppFrame current="home" canAdminister={false} phoneBar={<p>The bar</p>}>
        <p>The page</p>
      </AppFrame>,
    );
    const main = screen.getByRole("main");
    const bar = screen.getByText("The bar");
    expect(main.contains(bar)).toBe(false);
    expect(main.nextElementSibling?.contains(bar)).toBe(true);
  });

  it("leaves no empty bar on pages without one", () => {
    render(
      <AppFrame current="admin" canAdminister>
        <p>The page</p>
      </AppFrame>,
    );
    expect(screen.getByRole("main").nextElementSibling).toBeNull();
  });
});
