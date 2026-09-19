import { cookies, headers } from "next/headers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVICE_COOKIE } from "../../lib/notifications/device";
import { createClient } from "../../lib/supabase/server";
import { type DeviceSubscription, saveDevice } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)";

const device = {
  endpoint: "https://web.push.apple.com/QGuQyavXutnMfBCd",
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7KI4CCXg" },
};

function given({
  signedIn = true,
  upsertError = null as { code: string; message: string } | null,
} = {}) {
  const upsert = vi.fn(async () => ({ error: upsertError }));
  const from = vi.fn(() => ({ upsert }));
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn(async () => ({
        data: signedIn ? { claims: { sub: "user-1" } } : null,
        error: null,
      })),
    },
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(headers).mockResolvedValue(
    new Headers({ "user-agent": IPHONE }) as unknown as Awaited<ReturnType<typeof headers>>,
  );
  const set = vi.fn();
  vi.mocked(cookies).mockResolvedValue(
    { set } as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  return { from, upsert, set };
}

describe("saveDevice", () => {
  afterEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(headers).mockReset();
    vi.mocked(cookies).mockReset();
    vi.restoreAllMocks();
  });

  it("saves the device against whoever is signed in", async () => {
    const { from, upsert } = given();
    expect(await saveDevice(device)).toEqual({ saved: true });
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(upsert).toHaveBeenCalledWith(
      {
        endpoint: device.endpoint,
        p256dh: device.keys.p256dh,
        auth: device.keys.auth,
        user_agent: IPHONE,
      },
      { onConflict: "endpoint" },
    );
  });

  it("never says whose device it is; the database fills in the signed-in person", async () => {
    const { upsert } = given();
    await saveDevice(device);
    const [row] = upsert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(row).not.toHaveProperty("user_id");
  });

  it("saves a second device as its own row, found by its own address", async () => {
    const { upsert } = given();
    await saveDevice(device);
    await saveDevice({ ...device, endpoint: "https://web.push.apple.com/SecondDevice" });
    const endpoints = upsert.mock.calls.map(
      (call) => (call as unknown as [{ endpoint: string }])[0].endpoint,
    );
    expect(endpoints).toEqual([device.endpoint, "https://web.push.apple.com/SecondDevice"]);
  });

  // Signing out ends notifications for this device only, so it has to know
  // which device this browser is.
  it("remembers this device, so signing out can end its notifications", async () => {
    const { set } = given();
    await saveDevice(device);
    const [name, value, options] = set.mock.calls[0] as unknown as [
      string,
      string,
      { httpOnly: boolean },
    ];
    expect(name).toBe(DEVICE_COOKIE);
    expect(value).toBe(device.endpoint);
    expect(options.httpOnly).toBe(true);
  });

  it("remembers nothing when saving was refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { set } = given({ upsertError: { code: "42501", message: "refused" } });
    await saveDevice(device);
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in", async () => {
    const { upsert } = given({ signedIn: false });
    expect(await saveDevice(device)).toEqual({
      saved: false,
      error: "Sign in again, then turn notifications on.",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses something that isn't a device subscription", async () => {
    const { upsert } = given();
    const notText = { ...device, keys: { ...device.keys, auth: 42 } };
    const oversized = { ...device, endpoint: `${device.endpoint}${"x".repeat(2048)}` };
    for (const bad of [{}, { endpoint: device.endpoint }, { keys: device.keys }, notText, oversized]) {
      expect((await saveDevice(bad as DeviceSubscription)).saved).toBe(false);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  // The raw database message goes to the server log, not the screen.
  it("explains a device already signed up under someone else in plain words", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    given({
      upsertError: { code: "42501", message: "new row violates row-level security policy" },
    });
    expect(await saveDevice(device)).toEqual({
      saved: false,
      takenByAnother: true,
      error:
        "This device is already signed up for notifications under someone else in the household.",
    });
    expect(log).toHaveBeenCalledWith(
      "saveDevice failed",
      "42501",
      "new row violates row-level security policy",
    );
  });

  it("explains an address the database won't accept in plain words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    given({ upsertError: { code: "23514", message: "violates check constraint" } });
    expect(await saveDevice(device)).toEqual({
      saved: false,
      error: "That notification address isn't from a push service HomeBase accepts.",
    });
  });

  it("asks to try again for anything else, without showing the database's words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    given({ upsertError: { code: "08006", message: "connection failure" } });
    expect(await saveDevice(device)).toEqual({
      saved: false,
      error: "Couldn't save this device. Try again in a moment.",
    });
  });
});
