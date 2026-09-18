import { describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { signOut } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

describe("signOut", () => {
  it("ends the session, then sends the visitor to sign-in", async () => {
    const client = { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } };
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in");
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out this device only, never the person's other devices", async () => {
    const client = { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } };
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await signOut().catch(() => {});
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
