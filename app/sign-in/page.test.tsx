// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import SignInPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));

function givenHouseholdExists(exists: boolean) {
  vi.mocked(createClient).mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: exists, error: null }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("SignInPage", () => {
  afterEach(cleanup);

  it("offers the sign-in form once a household exists", async () => {
    givenHouseholdExists(true);
    render(await SignInPage());
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeDefined();
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Create your household" })).toBeNull();
  });

  it("points to sign-up instead while no household exists", async () => {
    givenHouseholdExists(false);
    render(await SignInPage());
    const link = screen.getByRole("link", { name: "Create your household" });
    expect(link.getAttribute("href")).toBe("/sign-up");
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  // REQ-86: the same page as sign-up and set-password, with the logo.
  it("shows the HomeBase icon and name above the form", async () => {
    givenHouseholdExists(true);
    render(await SignInPage());
    expect(document.querySelector('img[src="/icon.svg"]')).not.toBeNull();
    expect(screen.getByText("HomeBase")).toBeDefined();
  });
});
