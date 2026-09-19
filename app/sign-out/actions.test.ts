import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_COOKIE } from "../../lib/auth/mode";
import { DEVICE_COOKIE } from "../../lib/notifications/device";
import { createClient } from "../../lib/supabase/server";
import { signOut } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({
  device = null as string | null,
  deleteError = null as { code: string; message: string } | null,
  deleteThrows = false,
} = {}) {
  const eq = deleteThrows
    ? vi.fn().mockRejectedValue(new Error("network down"))
    : vi.fn().mockResolvedValue({ error: deleteError });
  const from = vi.fn(() => ({ delete: vi.fn(() => ({ eq })) }));
  const client = {
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    from,
  };
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  const store = {
    delete: vi.fn(),
    get: vi.fn((name: string) =>
      name === DEVICE_COOKIE && device ? { value: device } : undefined,
    ),
  };
  vi.mocked(cookies).mockResolvedValue(
    store as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  return { client, store, from, eq };
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

  // The row is what the sender reaches, and removing it needs the session
  // that is about to end, so it has to happen first.
  it("ends notifications on this device before it ends the session", async () => {
    const device = "https://web.push.apple.com/this-device";
    const { client, store, from, eq } = given({ device });
    await signOut().catch(() => {});
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(eq).toHaveBeenCalledWith("endpoint", device);
    expect(eq.mock.invocationCallOrder[0]).toBeLessThan(
      client.auth.signOut.mock.invocationCallOrder[0],
    );
    expect(store.delete).toHaveBeenCalledWith(DEVICE_COOKIE);
    expect(store.delete.mock.invocationCallOrder[0]).toBeLessThan(
      client.auth.signOut.mock.invocationCallOrder[0],
    );
  });

  it("signs out anyway when ending notifications fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = given({
      device: "https://web.push.apple.com/this-device",
      deleteError: { code: "08006", message: "connection failure" },
    });
    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in");
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("signs out anyway when ending notifications throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = given({
      device: "https://web.push.apple.com/this-device",
      deleteThrows: true,
    });
    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in");
    expect(client.auth.signOut).toHaveBeenCalled();
    log.mockRestore();
  });

  it("leaves the table alone when this device never turned notifications on", async () => {
    const { from, store } = given();
    await signOut().catch(() => {});
    expect(from).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalledWith(DEVICE_COOKIE);
  });

  it("forgets admin mode, so the next sign-in starts in member view", async () => {
    const { store } = given();
    await signOut().catch(() => {});
    expect(store.delete).toHaveBeenCalledWith(MODE_COOKIE);
  });
});
