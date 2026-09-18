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

function given({
  email,
  permissions = [],
}: {
  email: string | null;
  permissions?: string[];
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: email === null ? null : { claims: { email, sub: "user-1" } },
        error: null,
      }),
    },
    rpc: vi.fn(async (_fn: string, args: { permission: string }) => ({
      data: permissions.includes(args.permission),
      error: null,
    })),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("HomePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("shows HomeBase and who is signed in", async () => {
    given({ email: "member@example.com" });
    render(await HomePage());
    expect(screen.getByRole("heading", { name: "HomeBase" })).toBeDefined();
    expect(screen.getByText("Signed in as member@example.com")).toBeDefined();
  });

  it("offers sign-out", async () => {
    given({ email: "member@example.com" });
    render(await HomePage());
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  });

  it("sends a signed-out visitor to sign-in", async () => {
    given({ email: null });
    await expect(HomePage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("mentions managing members only when that permission is held", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    render(await HomePage());
    expect(screen.getByText("You can manage members.")).toBeDefined();
    cleanup();

    given({ email: "member@example.com", permissions: ["use_modules"] });
    render(await HomePage());
    expect(screen.queryByText("You can manage members.")).toBeNull();
  });

  it("falls back to placeholder build info when Vercel env vars are unset", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    render(await HomePage());
    expect(screen.getByTestId("build-info").textContent).toBe("dev · local");
  });

  it("shows the ref and short commit hash when Vercel env vars are set", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    render(await HomePage());
    expect(screen.getByTestId("build-info").textContent).toBe(
      "main · abcdef1",
    );
  });
});
