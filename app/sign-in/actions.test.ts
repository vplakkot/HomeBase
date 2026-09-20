import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_IN_FAILED_MESSAGE } from "../../lib/auth/messages";
import { DEVICE_COOKIE } from "../../lib/notifications/device";
import { createClient } from "../../lib/supabase/server";
import { signIn } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

let store: { delete: ReturnType<typeof vi.fn> };

function fakeClient(signInError: { message: string } | null) {
  const client = {
    auth: {
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ data: {}, error: signInError }),
    },
  };
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  store = { delete: vi.fn() };
  vi.mocked(cookies).mockResolvedValue(
    store as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  return client;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

describe("signIn", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(cookies).mockReset();
  });

  // The note says which device this browser is for notifications. Left
  // behind, it would decide what the next person sees.
  it("forgets the previous person's device note", async () => {
    fakeClient(null);
    await signIn({}, form({ email: "member@example.com", password: "pw" })).catch(() => {});
    expect(store.delete).toHaveBeenCalledWith(DEVICE_COOKIE);
  });

  it("leaves the note alone when signing in fails", async () => {
    fakeClient({ message: "Invalid login credentials" });
    await signIn({}, form({ email: "member@example.com", password: "pw" }));
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("rejects a missing email or password before touching Supabase", async () => {
    const client = fakeClient(null);
    const state = await signIn({}, form({ email: "", password: "" }));
    expect(state.error).toBe("Email and password are required.");
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("sends a signed-in member home", async () => {
    const client = fakeClient(null);
    await expect(
      signIn({}, form({ email: " member@example.com ", password: "secret123" })),
    ).rejects.toThrow("REDIRECT:/");
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "secret123",
    });
  });

  it("gives the same message for a wrong password and an unknown email", async () => {
    fakeClient({ message: "Invalid login credentials" });
    const wrongPassword = await signIn(
      {},
      form({ email: "member@example.com", password: "nope" }),
    );

    fakeClient({ message: "User not found" });
    const unknownEmail = await signIn(
      {},
      form({ email: "nobody@example.com", password: "secret123" }),
    );

    expect(wrongPassword.error).toBe(SIGN_IN_FAILED_MESSAGE);
    expect(unknownEmail.error).toBe(SIGN_IN_FAILED_MESSAGE);
    expect(wrongPassword).toEqual(unknownEmail);
  });

  it("never echoes Supabase's own error text", async () => {
    fakeClient({ message: "Email not confirmed" });
    const state = await signIn(
      {},
      form({ email: "member@example.com", password: "secret123" }),
    );
    expect(state.error).toBe(SIGN_IN_FAILED_MESSAGE);
    expect(state.error).not.toContain("confirmed");
  });
});
