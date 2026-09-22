// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import SetPasswordPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../sign-out/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given(signedIn: boolean) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: signedIn ? { claims: { sub: "user-2" } } : null,
        error: null,
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("SetPasswordPage", () => {
  afterEach(cleanup);

  it("sends a signed-out visitor to sign-in", async () => {
    given(false);
    await expect(SetPasswordPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("asks for the new password twice, and still offers a way out", async () => {
    given(true);
    render(await SetPasswordPage());
    expect(screen.getByRole("heading", { name: "Set a new password" })).toBeDefined();
    expect(screen.getByLabelText("New password")).toBeDefined();
    expect(screen.getByLabelText("New password again")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save password" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  });

  // REQ-86: the same page as sign-up and set-password, with the logo.
  it("shows the HomeBase icon and name above the form", async () => {
    given(true);
    render(await SetPasswordPage());
    expect(document.querySelector('img[src="/icon.svg"]')).not.toBeNull();
    expect(screen.getByText("HomeBase")).toBeDefined();
  });
});
