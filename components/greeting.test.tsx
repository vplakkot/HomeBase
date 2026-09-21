// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Greeting, dateLine, greetingFor } from "./greeting";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the greeting word", () => {
  it.each([
    [0, "Morning"],
    [11, "Morning"],
    [12, "Afternoon"],
    [17, "Afternoon"],
    [18, "Evening"],
    [23, "Evening"],
  ])("at %i:00 is %s", (hour, word) => {
    expect(greetingFor(hour)).toBe(word);
  });
});

describe("the date line", () => {
  it("reads like the mockups", () => {
    expect(dateLine(new Date(2026, 8, 20, 9))).toBe("Sunday, 20 September");
  });
});

describe("the greeting", () => {
  it("uses the phone's own clock, with the name when there is one", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20, 9, 30));
    render(<Greeting name="Sam" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Morning, Sam");
    expect(screen.getByText("Sunday, 20 September")).toBeDefined();
  });

  it("says just the greeting when the account has no name", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20, 19, 0));
    render(<Greeting name={null} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Evening");
  });
});
