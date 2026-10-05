import { cookies, headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_COOKIE } from "../../lib/notifications/device";
import { endpointHash, listDevices, removeDevice } from "../../lib/notifications/devices";
import { sendPush } from "../../lib/notifications/send";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";
import { myDevices, removeMyDevice, saveDevice, sendTestToMyDevice } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../lib/notifications/devices", async (original) => ({
  ...(await original<typeof import("../../lib/notifications/devices")>()),
  listDevices: vi.fn(),
  removeDevice: vi.fn(),
}));
vi.mock("../../lib/notifications/send", () => ({
  sendPush: vi.fn(),
  MESSAGES: { manual: { title: "HomeBase", body: "Test notification, sent by hand." } },
}));

const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMfBCd";
const subscription = { endpoint: ENDPOINT, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7KI4CCXg" } };

// What this person's own session can see: row-level security shows them
// only their own device rows, so a device that isn't theirs is simply not
// found.
function given({ mine = true, removedMark = false, cookieValue = ENDPOINT as string | undefined } = {}) {
  const upsert = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({
    upsert,
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: mine ? { id: "d1", endpoint: ENDPOINT } : null, error: null }) }),
    }),
  }));
  vi.mocked(createClient).mockResolvedValue({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { sub: "u1" } }, error: null })) },
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);

  const markDeleted = vi.fn();
  const admin = {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: removedMark ? { endpoint_hash: "x" } : null, error: null }) }) }),
      delete: () => ({
        eq: async (_column: string, hash: string) => {
          markDeleted(hash);
          return { error: null };
        },
      }),
    })),
  };
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);

  const del = vi.fn();
  const set = vi.fn();
  vi.mocked(cookies).mockResolvedValue(
    { get: () => (cookieValue ? { value: cookieValue } : undefined), delete: del, set } as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  vi.mocked(headers).mockResolvedValue(
    new Headers({ host: "homebase.example", "user-agent": "x" }) as unknown as Awaited<ReturnType<typeof headers>>,
  );
  return { upsert, markDeleted, del };
}

beforeEach(() => {
  vi.mocked(removeDevice).mockReset();
  vi.mocked(listDevices).mockReset();
  vi.mocked(sendPush).mockReset();
});

describe("a removed device (REQ-160)", () => {
  it("isn't put back by the quiet sign-up when Home opens on that phone", async () => {
    const { upsert } = given({ removedMark: true });
    expect(await saveDevice(subscription, { quiet: true })).toEqual({
      saved: false,
      error: "This device was removed from the list.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("is signed up again by a deliberate tap, which clears the mark", async () => {
    const { upsert, markDeleted } = given({ removedMark: true });
    expect(await saveDevice(subscription)).toEqual({ saved: true });
    expect(markDeleted).toHaveBeenCalledWith(endpointHash(ENDPOINT));
    expect(upsert).toHaveBeenCalled();
  });

  it("lets the quiet sign-up through for a device never removed", async () => {
    const { upsert } = given({ removedMark: false });
    expect(await saveDevice(subscription, { quiet: true })).toEqual({ saved: true });
    expect(upsert).toHaveBeenCalled();
  });
});

describe("myDevices", () => {
  it("lists only the signed-in person's devices, marking the one this browser noted", async () => {
    given();
    vi.mocked(listDevices).mockResolvedValue(new Map([["u1", [{ id: "d1", name: "iPhone, Safari", addedAt: "a", lastReceivedAt: null, thisDevice: true }]]]));
    expect(await myDevices()).toHaveLength(1);
    expect(listDevices).toHaveBeenCalledWith(expect.anything(), ["u1"], ENDPOINT);
  });
});

describe("removeMyDevice", () => {
  it("removes one of your own, and forgets this browser's note when it was this device", async () => {
    const { del } = given();
    vi.mocked(removeDevice).mockResolvedValue(ENDPOINT);
    expect(await removeMyDevice("d1")).toEqual({ done: "Removed." });
    expect(removeDevice).toHaveBeenCalledWith(expect.anything(), "d1");
    expect(del).toHaveBeenCalledWith(DEVICE_COOKIE);
  });

  it("leaves this browser's note alone when it was another device", async () => {
    const { del } = given({ cookieValue: "https://web.push.apple.com/other" });
    vi.mocked(removeDevice).mockResolvedValue(ENDPOINT);
    await removeMyDevice("d1");
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses a device that isn't yours: it isn't even found", async () => {
    given({ mine: false });
    expect(await removeMyDevice("someone-elses")).toEqual({ error: "That device is already gone." });
    expect(removeDevice).not.toHaveBeenCalled();
  });
});

describe("sendTestToMyDevice", () => {
  it("sends to that one device of yours and no other", async () => {
    given();
    vi.mocked(sendPush).mockResolvedValue({ trigger: "manual", people: 1, devices: 1, delivered: 1, failed: 0, removed: 0, outcomes: [] });
    expect(await sendTestToMyDevice("d1")).toEqual({ done: "Sent." });
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "manual", to: ["u1"], onlyEndpoint: ENDPOINT }),
    );
  });

  it("says so when your switch is off", async () => {
    given();
    vi.mocked(sendPush).mockResolvedValue({ trigger: "manual", people: 0, devices: 0, delivered: 0, failed: 0, removed: 0, outcomes: [] });
    expect(await sendTestToMyDevice("d1")).toEqual({
      error: "Notifications are switched off for you, so nothing was sent.",
    });
  });

  it("refuses a device that isn't yours", async () => {
    given({ mine: false });
    expect(await sendTestToMyDevice("someone-elses")).toEqual({ error: "That device is already gone." });
    expect(sendPush).not.toHaveBeenCalled();
  });
});
