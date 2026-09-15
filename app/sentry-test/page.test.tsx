import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SentryTestPage from "./page";

describe("SentryTestPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders both deliberate-error buttons", () => {
    render(<SentryTestPage />);
    expect(
      screen.getByRole("button", { name: "Throw client error" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Throw server error" }),
    ).toBeDefined();
  });
});
