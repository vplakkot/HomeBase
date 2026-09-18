import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_UP_CLOSED_MESSAGE } from "../../lib/household";
import { createClient } from "../../lib/supabase/server";
import { signUp } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function fakeClient({
  householdExists,
  signUpError = null,
}: {
  householdExists: boolean | boolean[];
  signUpError?: { message: string } | null;
}) {
  const answers = Array.isArray(householdExists)
    ? householdExists
    : [householdExists];
  const rpc = vi.fn();
  for (const answer of answers) {
    rpc.mockResolvedValueOnce({ data: answer, error: null });
  }
  const client = {
    rpc,
    auth: {
      signUp: vi.fn().mockResolvedValue({ data: {}, error: signUpError }),
    },
  };
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return client as unknown as SupabaseClient & typeof client;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

describe("signUp", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("rejects a missing email or password before touching Supabase", async () => {
    const client = fakeClient({ householdExists: false });
    const state = await signUp({}, form({ email: "", password: "" }));
    expect(state.error).toBe("Email and password are required.");
    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it("refuses when a household already exists and never creates a user", async () => {
    const client = fakeClient({ householdExists: true });
    const state = await signUp(
      {},
      form({ email: "second@example.com", password: "secret123" }),
    );
    expect(state.error).toBe(SIGN_UP_CLOSED_MESSAGE);
    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it("creates the first user and sends them home", async () => {
    const client = fakeClient({ householdExists: false });
    await expect(
      signUp({}, form({ email: "  first@example.com ", password: "secret123" })),
    ).rejects.toThrow("REDIRECT:/");
    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: "first@example.com",
      password: "secret123",
    });
  });

  it("explains that sign-up is closed when the database refused the user", async () => {
    // Two sign-ups racing: the check passed, then the trigger refused.
    fakeClient({
      householdExists: [false, true],
      signUpError: { message: "Database error saving new user" },
    });
    const state = await signUp(
      {},
      form({ email: "second@example.com", password: "secret123" }),
    );
    expect(state.error).toBe(SIGN_UP_CLOSED_MESSAGE);
  });

  it("shows any other Supabase error as-is", async () => {
    fakeClient({
      householdExists: [false, false],
      signUpError: { message: "Password should be at least 6 characters" },
    });
    const state = await signUp(
      {},
      form({ email: "first@example.com", password: "short" }),
    );
    expect(state.error).toBe("Password should be at least 6 characters");
  });
});
