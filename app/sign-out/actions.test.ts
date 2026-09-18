import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_COOKIE } from "../../lib/auth/mode";
import { createClient } from "../../lib/supabase/server";
import { signOut } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given() {
  const client = { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } };
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  const store = { delete: vi.fn() };
  vi.mocked(cookies).mockResolvedValue(
    store as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  return { client, store };
}

describe("signOut", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(cookies).mockReset();
  });

  it("ends the session, then sends the visitor to sign-in", async () => {
    const { client } = given();
    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in");
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out this device only, never the person's other devices", async () => {
    const { client } = given();
    await signOut().catch(() => {});
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("forgets admin mode, so the next sign-in starts in member view", async () => {
    const { store } = given();
    await signOut().catch(() => {});
    expect(store.delete).toHaveBeenCalledWith(MODE_COOKIE);
  });
});
