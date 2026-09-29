// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "./app-frame";
import { TEST_ACCOUNT } from "../test/account";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

afterEach(cleanup);

describe("the app frame", () => {
  it("puts the page in the main area, beside the sidebar", () => {
    render(
      <AppFrame current="home" canAdminister={false} account={TEST_ACCOUNT}>
        <p>The page</p>
      </AppFrame>,
    );
    expect(screen.getByRole("main").textContent).toBe("The page");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeDefined();
  });

  it("puts a phone bar below the main area, outside it, so it doesn't scroll away", () => {
    render(
      <AppFrame current="home" canAdminister={false} account={TEST_ACCOUNT} phoneBar={<p>The bar</p>}>
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
      <AppFrame current="admin" canAdminister account={TEST_ACCOUNT}>
        <p>The page</p>
      </AppFrame>,
    );
    expect(screen.getByRole("main").nextElementSibling).toBeNull();
  });

  // REQ-141: every module page sits in the frame, so a link to a module
  // that's off, old or typed, lands on Home instead.
  it("sends a page of a module that's off to Home, saying which", () => {
    const account = { ...TEST_ACCOUNT, modules: { off: ["drinks"], hidden: [] } };
    expect(() =>
      render(
        <AppFrame current="drinks" canAdminister={false} account={account}>
          <p>The page</p>
        </AppFrame>,
      ),
    ).toThrow("REDIRECT:/?off=drinks");
  });

  // REQ-143: hidden only leaves your navigation, so an action item can
  // still take you there.
  it("still opens a module you've hidden", () => {
    const account = { ...TEST_ACCOUNT, modules: { off: [], hidden: ["drinks"] } };
    render(
      <AppFrame current="drinks" canAdminister={false} account={account}>
        <p>The page</p>
      </AppFrame>,
    );
    expect(screen.getByRole("main").textContent).toBe("The page");
  });
});
