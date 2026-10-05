// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deviceName, endpointHash, listDevices, removeDevice } from "./devices";
import { fingerprintOf } from "./send";

vi.mock("web-push", () => ({ default: {}, WebPushError: class extends Error {} }));
vi.mock("../supabase/admin", () => ({ createAdminClient: vi.fn() }));

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

describe("deviceName", () => {
  it("reads a device and browser a person would recognise", () => {
    expect(deviceName(IPHONE_SAFARI)).toBe("iPhone, Safari");
    expect(deviceName(MAC_CHROME)).toBe("Mac, Chrome");
    expect(deviceName(ANDROID_CHROME)).toBe("Android, Chrome");
    expect(deviceName(WINDOWS_EDGE)).toBe("Windows, Edge");
  });

  it("says unknown rather than guessing", () => {
    expect(deviceName(null)).toBe("Unknown device");
    expect(deviceName("curl/8")).toBe("Unknown device");
  });
});

const E1 = "https://web.push.apple.com/one";
const E2 = "https://fcm.googleapis.com/two";

function fakeAdmin({
  subscriptions = [] as Record<string, unknown>[],
  log = [] as Record<string, unknown>[],
  existing = null as Record<string, unknown> | null,
} = {}) {
  const calls: { table: string; op: string; arg?: unknown }[] = [];
  const from = vi.fn((table: string) => {
    if (table === "push_subscriptions") {
      return {
        select: () => ({
          in: () => ({ order: async () => ({ data: subscriptions, error: null }) }),
          eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }),
        }),
        delete: () => ({
          eq: async (_column: string, id: string) => {
            calls.push({ table, op: "delete", arg: id });
            return { error: null };
          },
        }),
      };
    }
    if (table === "notification_log") {
      return { select: () => ({ in: () => ({ not: async () => ({ data: log, error: null }) }) }) };
    }
    return {
      upsert: async (row: unknown) => {
        calls.push({ table, op: "upsert", arg: row });
        return { error: null };
      },
    };
  });
  return { admin: { from } as unknown as SupabaseClient, calls };
}

describe("listDevices", () => {
  it("names each device, marks this one, and shows when it last received something", async () => {
    const { admin } = fakeAdmin({
      subscriptions: [
        { id: "d1", user_id: "u1", endpoint: E1, user_agent: IPHONE_SAFARI, created_at: "2026-10-01T10:00:00Z" },
        { id: "d2", user_id: "u1", endpoint: E2, user_agent: MAC_CHROME, created_at: "2026-10-02T10:00:00Z" },
      ],
      log: [
        { user_id: "u1", device: fingerprintOf(E1), delivered_at: "2026-10-03T08:00:00Z" },
        { user_id: "u1", device: fingerprintOf(E1), delivered_at: "2026-10-04T08:00:00Z" },
      ],
    });
    const devices = (await listDevices(admin, ["u1"], E1)).get("u1");
    expect(devices).toEqual([
      { id: "d1", name: "iPhone, Safari", addedAt: "2026-10-01T10:00:00Z", lastReceivedAt: "2026-10-04T08:00:00Z", thisDevice: true },
      { id: "d2", name: "Mac, Chrome", addedAt: "2026-10-02T10:00:00Z", lastReceivedAt: null, thisDevice: false },
    ]);
  });

  it("never hands the push address to the screen", async () => {
    const { admin } = fakeAdmin({
      subscriptions: [{ id: "d1", user_id: "u1", endpoint: E1, user_agent: null, created_at: "2026-10-01T10:00:00Z" }],
    });
    expect(JSON.stringify([...(await listDevices(admin, ["u1"])).values()])).not.toContain("push.apple.com");
  });

  it("returns nothing for nobody", async () => {
    expect((await listDevices(fakeAdmin().admin, [])).size).toBe(0);
  });
});

describe("removeDevice", () => {
  it("marks the address as removed, then deletes the row, and returns the address", async () => {
    const { admin, calls } = fakeAdmin({ existing: { user_id: "u1", endpoint: E1 } });
    expect(await removeDevice(admin, "d1")).toBe(E1);
    expect(calls).toEqual([
      { table: "removed_devices", op: "upsert", arg: { endpoint_hash: endpointHash(E1), user_id: "u1" } },
      { table: "push_subscriptions", op: "delete", arg: "d1" },
    ]);
  });

  it("keeps a hash, never the address, in the mark", async () => {
    const { admin, calls } = fakeAdmin({ existing: { user_id: "u1", endpoint: E1 } });
    await removeDevice(admin, "d1");
    expect(JSON.stringify(calls[0])).not.toContain("push.apple.com");
  });

  it("does nothing for a device that isn't there", async () => {
    const { admin, calls } = fakeAdmin({ existing: null });
    expect(await removeDevice(admin, "nope")).toBeNull();
    expect(calls).toEqual([]);
  });
});
