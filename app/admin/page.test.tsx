import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import AdminPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({ signedIn, permissions = [] }: { signedIn: boolean; permissions?: string[] }) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: signedIn ? { claims: { sub: "user-1" } } : null,
        error: null,
      }),
    },
    rpc: vi.fn(async (_fn: string, args: { permission: string }) => ({
      data: permissions.includes(args.permission),
      error: null,
    })),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("AdminPage", () => {
  afterEach(cleanup);

  it("sends a signed-out visitor to sign-in", async () => {
    given({ signedIn: false });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("refuses a member who types the URL", async () => {
    given({ signedIn: true, permissions: ["use_modules"] });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
  });

  it("opens for someone who may manage members", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    expect(screen.getByRole("heading", { name: "Admin console" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Members" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
  });
});
