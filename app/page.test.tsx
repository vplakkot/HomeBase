import { cleanup, render, screen } from "@testing-library/react";
import { cookies } from "next/headers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MODE_COOKIE } from "../lib/auth/mode";
import { createClient } from "../lib/supabase/server";
import HomePage from "./page";

vi.mock("../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./sign-out/actions", () => ({ signOut: vi.fn() }));
vi.mock("./mode/actions", () => ({
  enterAdminMode: vi.fn(),
  leaveAdminMode: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
// The notifications control runs in the browser and has its own tests; here
// it only has to be on the page, holding the server's push key.
vi.mock("./notifications/enable-notifications", () => ({
  EnableNotifications: ({ publicKey }: { publicKey?: string }) => (
    <p data-testid="notifications">{publicKey ?? "no key"}</p>
  ),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({
  email,
  permissions = [],
  mode,
}: {
  email: string | null;
  permissions?: string[];
  mode?: "admin";
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
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) =>
      name === MODE_COOKIE && mode ? { value: mode } : undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
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

  it("shows an admin the member view with a toggle into admin mode", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    render(await HomePage());
    expect(screen.getByRole("button", { name: "Enter admin mode" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Admin console" })).toBeNull();
  });

  it("in admin mode, shows the banner, the console link and the way back", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"], mode: "admin" });
    render(await HomePage());
    expect(screen.getByText("Admin mode")).toBeDefined();
    expect(screen.getByRole("link", { name: "Admin console" }).getAttribute("href")).toBe("/admin");
    expect(screen.getByRole("button", { name: "Back to member view" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Enter admin mode" })).toBeNull();
  });

  it("never shows a member the toggle, even with a stray admin cookie", async () => {
    given({ email: "member@example.com", permissions: ["use_modules"], mode: "admin" });
    render(await HomePage());
    expect(screen.queryByRole("button", { name: "Enter admin mode" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Admin console" })).toBeNull();
    expect(screen.queryByText("Admin mode")).toBeNull();
  });

  it("offers notifications, handing over the server's push key", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-push-key");
    render(await HomePage());
    expect(screen.getByTestId("notifications").textContent).toBe("public-push-key");
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
