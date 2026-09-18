import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../lib/supabase/server";
import HomePage from "./page";

vi.mock("../lib/supabase/server", () => ({ createClient: vi.fn() }));

function givenHouseholdExists(exists: boolean) {
  vi.mocked(createClient).mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: exists, error: null }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("HomePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("shows HomeBase", async () => {
    givenHouseholdExists(false);
    render(await HomePage());
    expect(screen.getByRole("heading", { name: "HomeBase" })).toBeDefined();
  });

  it("offers creating the household while none exists", async () => {
    givenHouseholdExists(false);
    render(await HomePage());
    const link = screen.getByRole("link", { name: "Create your household" });
    expect(link.getAttribute("href")).toBe("/sign-up");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("offers only sign-in once the household exists", async () => {
    givenHouseholdExists(true);
    render(await HomePage());
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/sign-in");
    expect(
      screen.queryByRole("link", { name: "Create your household" }),
    ).toBeNull();
  });

  it("falls back to placeholder build info when Vercel env vars are unset", async () => {
    givenHouseholdExists(false);
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    render(await HomePage());
    expect(screen.getByTestId("build-info").textContent).toBe("dev · local");
  });

  it("shows the ref and short commit hash when Vercel env vars are set", async () => {
    givenHouseholdExists(false);
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    render(await HomePage());
    expect(screen.getByTestId("build-info").textContent).toBe(
      "main · abcdef1",
    );
  });
});
