import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("shows HomeBase", () => {
    render(<HomePage />);
    expect(screen.getByText("HomeBase")).toBeDefined();
  });

  it("falls back to placeholder build info when Vercel env vars are unset", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    render(<HomePage />);
    expect(screen.getByTestId("build-info").textContent).toBe("dev · local");
  });

  it("shows the ref and short commit hash when Vercel env vars are set", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    render(<HomePage />);
    expect(screen.getByTestId("build-info").textContent).toBe(
      "main · abcdef1",
    );
  });
});
