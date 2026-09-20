// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import SignUpPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));

function givenHouseholdExists(exists: boolean) {
  vi.mocked(createClient).mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: exists, error: null }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("SignUpPage", () => {
  afterEach(cleanup);

  it("offers the sign-up form while no household exists", async () => {
    givenHouseholdExists(false);
    render(await SignUpPage());
    expect(screen.getByRole("heading", { name: "Create your household" })).toBeDefined();
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create household" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("is closed once a household exists: no form, only sign-in", async () => {
    givenHouseholdExists(true);
    render(await SignUpPage());
    expect(screen.getByRole("heading", { name: "Sign-up is closed" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create household" })).toBeNull();
  });
});
