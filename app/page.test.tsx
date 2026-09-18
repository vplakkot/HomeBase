import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../lib/supabase/server";
import HomePage from "./page";

vi.mock("../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./sign-out/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function givenSignedIn(email: string | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: email === null ? null : { claims: { email, sub: "user-1" } },
        error: null,
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("HomePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("shows HomeBase and who is signed in", async () => {
    givenSignedIn("member@example.com");
    render(await HomePage());
    expect(screen.getByRole("heading", { name: "HomeBase" })).toBeDefined();
    expect(screen.getByText("Signed in as member@example.com")).toBeDefined();
  });

  it("offers sign-out", async () => {
    givenSignedIn("member@example.com");
    render(await HomePage());
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  });

  it("sends a signed-out visitor to sign-in", async () => {
    givenSignedIn(null);
    await expect(HomePage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("falls back to placeholder build info when Vercel env vars are unset", async () => {
    givenSignedIn("member@example.com");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    render(await HomePage());
    expect(screen.getByTestId("build-info").textContent).toBe("dev · local");
  });

  it("shows the ref and short commit hash when Vercel env vars are set", async () => {
    givenSignedIn("member@example.com");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    render(await HomePage());
    expect(screen.getByTestId("build-info").textContent).toBe(
      "main · abcdef1",
    );
  });
});
