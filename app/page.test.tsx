// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { cookies } from "next/headers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVICE_COOKIE } from "../lib/notifications/device";
import { createClient } from "../lib/supabase/server";
import HomePage from "./page";

vi.mock("../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./sign-out/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
// The notifications control runs in the browser and has its own tests; here
// it only has to be on the page, holding the server's push key.
vi.mock("./notifications/enable-notifications", () => ({
  EnableNotifications: ({
    publicKey,
    knownDevice,
  }: {
    publicKey?: string;
    knownDevice?: string | null;
  }) => (
    <p data-testid="notifications">{`${publicKey ?? "no key"} · ${knownDevice ?? "no device"}`}</p>
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
  device,
  otherCookies = {},
}: {
  email: string | null;
  permissions?: string[];
  device?: string;
  otherCookies?: Record<string, string>;
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
    get: (name: string) => {
      if (name === DEVICE_COOKIE && device) return { value: device };
      return name in otherCookies ? { value: otherCookies[name] } : undefined;
    },
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("HomePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("starts with the brand lockup, top-left, then who is signed in", async () => {
    given({ email: "member@example.com" });
    const { container } = render(await HomePage());
    const first = container.firstElementChild;
    expect(first?.tagName).toBe("HEADER");
    expect(first?.querySelector("img")?.getAttribute("src")).toBe("/icon.svg");
    expect(first?.textContent).toBe("HomeBase");
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

  it("shows an admin the Admin pill, top-right, opening the admin console", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    const { container } = render(await HomePage());
    const pill = screen.getByRole("link", { name: "Admin" });
    expect(pill.getAttribute("href")).toBe("/admin");
    // After the brand lockup in the header, which lays the two out left and right.
    expect(container.querySelector("header")?.lastElementChild).toBe(pill);
  });

  it("never shows a member the Admin pill", async () => {
    given({ email: "member@example.com", permissions: ["use_modules"] });
    render(await HomePage());
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  // v0.1 kept an "admin mode" in a cookie. It's gone, and so is anything
  // that read it: only the permission decides.
  it("ignores a leftover admin-mode cookie from v0.1", async () => {
    given({
      email: "member@example.com",
      permissions: ["use_modules"],
      otherCookies: { "homebase-mode": "admin" },
    });
    render(await HomePage());
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("has no admin-mode switch any more", async () => {
    given({ email: "admin@example.com", permissions: ["manage_members"] });
    render(await HomePage());
    expect(screen.queryByRole("button", { name: "Enter admin mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to member view" })).toBeNull();
  });

  it("offers notifications, handing over the push key and this device's note", async () => {
    given({ email: "member@example.com", device: "https://web.push.apple.com/this" });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-push-key");
    render(await HomePage());
    expect(screen.getByTestId("notifications").textContent).toBe(
      "public-push-key · https://web.push.apple.com/this",
    );
  });

  it("hands over no device note when this browser never turned notifications on", async () => {
    given({ email: "member@example.com" });
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-push-key");
    render(await HomePage());
    expect(screen.getByTestId("notifications").textContent).toBe(
      "public-push-key · no device",
    );
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
