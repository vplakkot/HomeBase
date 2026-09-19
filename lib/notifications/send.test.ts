// @vitest-environment node
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "../supabase/admin";
import { sendTestNotification } from "./send";

vi.mock("web-push", () => {
  class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
    WebPushError,
  };
});
vi.mock("../supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { WebPushError } = await import("web-push");

type Device = { user_id: string; endpoint: string; p256dh: string; auth: string };

const VIN = "00000000-0000-0000-0000-00000000000a";
const MEGAN = "00000000-0000-0000-0000-00000000000b";

function device(user_id: string, name: string): Device {
  return {
    user_id,
    endpoint: `https://web.push.apple.com/${name}`,
    p256dh: `p256dh-${name}`,
    auth: `auth-${name}`,
  };
}

function givenHousehold({
  switchedOn = [] as string[],
  devices = [] as Device[],
}) {
  const asked: { ids?: string[] } = {};
  const deleted: string[] = [];
  const from = vi.fn((table: string) => {
    if (table === "household_members") {
      return {
        select: () => ({
          eq: async (_column: string, value: boolean) => ({
            data: value ? switchedOn.map((user_id) => ({ user_id })) : [],
            error: null,
          }),
        }),
      };
    }
    return {
      select: () => ({
        in: async (_column: string, ids: string[]) => {
          asked.ids = ids;
          // The real query only returns devices belonging to those ids.
          return {
            data: devices.filter((one) => ids.includes(one.user_id)),
            error: null,
          };
        },
      }),
      delete: () => ({
        eq: async (_column: string, endpoint: string) => {
          deleted.push(endpoint);
          return { error: null };
        },
      }),
    };
  });
  vi.mocked(createAdminClient).mockReturnValue(
    { from } as unknown as ReturnType<typeof createAdminClient>,
  );
  return { from, deleted, asked };
}

const send = () =>
  sendTestNotification({ subject: "https://homebase.example", trigger: "hourly" });

describe("sendTestNotification", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    vi.mocked(webpush.sendNotification).mockResolvedValue(
      {} as Awaited<ReturnType<typeof webpush.sendNotification>>,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("sends to every device of everyone switched on", async () => {
    givenHousehold({
      switchedOn: [VIN, MEGAN],
      devices: [device(VIN, "vin-phone"), device(VIN, "vin-ipad"), device(MEGAN, "megan-phone")],
    });
    const summary = await send();
    expect(summary).toMatchObject({ people: 2, devices: 3, delivered: 3, failed: 0 });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
    const [subscription, , options] = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(subscription).toEqual({
      endpoint: "https://web.push.apple.com/vin-phone",
      keys: { p256dh: "p256dh-vin-phone", auth: "auth-vin-phone" },
    });
    expect(options?.TTL).toBe(30 * 60);
  });

  // The switch is the whole point of REQ-16: off means nothing arrives.
  it("never asks for, or sends to, the devices of someone switched off", async () => {
    const { asked } = givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "vin-phone"), device(MEGAN, "megan-phone")],
    });
    const summary = await send();
    expect(asked.ids).toEqual([VIN]);
    expect(summary).toMatchObject({ people: 1, devices: 1, delivered: 1 });
    const endpoints = vi
      .mocked(webpush.sendNotification)
      .mock.calls.map(([subscription]) => subscription.endpoint);
    expect(endpoints).toEqual(["https://web.push.apple.com/vin-phone"]);
  });

  it("sends nothing at all when nobody is switched on", async () => {
    const { from } = givenHousehold({ switchedOn: [], devices: [device(VIN, "vin-phone")] });
    const summary = await send();
    expect(summary).toMatchObject({ people: 0, devices: 0, delivered: 0 });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("push_subscriptions");
  });

  it("signs with the app's own keys and address, never a person's", async () => {
    givenHousehold({ switchedOn: [VIN], devices: [device(VIN, "vin-phone")] });
    await send();
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      "https://homebase.example",
      "public-key",
      "private-key",
    );
  });

  it("says which kind of test it was", async () => {
    givenHousehold({ switchedOn: [VIN], devices: [device(VIN, "vin-phone")] });
    await sendTestNotification({ subject: "https://homebase.example", trigger: "manual" });
    const [, message] = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(JSON.parse(String(message))).toEqual({
      title: "HomeBase",
      body: "Test notification, sent by hand.",
      url: "/",
    });
  });

  it("keeps going when one device fails, and counts it", async () => {
    givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "vin-phone"), device(VIN, "vin-ipad")],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce(new WebPushError("boom", 500, {} as never, "", ""))
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof webpush.sendNotification>>);
    const summary = await send();
    expect(summary).toMatchObject({ devices: 2, delivered: 1, failed: 1, removed: 0 });
  });

  // A device that no longer exists would otherwise be retried for ever.
  it("forgets a device the push service says is gone", async () => {
    const { deleted } = givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "gone"), device(VIN, "missing"), device(VIN, "broken")],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce(new WebPushError("gone", 410, {} as never, "", ""))
      .mockRejectedValueOnce(new WebPushError("not found", 404, {} as never, "", ""))
      .mockRejectedValueOnce(new WebPushError("server error", 500, {} as never, "", ""));
    const summary = await send();
    expect(summary).toMatchObject({ delivered: 0, failed: 3, removed: 2 });
    expect(deleted).toEqual([
      "https://web.push.apple.com/gone",
      "https://web.push.apple.com/missing",
    ]);
  });

  // The push services refuse an http: contact address outright, which is
  // what the app's own address is on this laptop. Found by clicking the
  // button locally, which failed with exactly that message.
  it("offers an https contact address even when running on http", async () => {
    givenHousehold({ switchedOn: [VIN], devices: [device(VIN, "vin-phone")] });
    await sendTestNotification({
      subject: "http://localhost:3000",
      trigger: "manual",
    });
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      "https://localhost:3000",
      "public-key",
      "private-key",
    );
  });

  it("refuses an address that is neither https nor mailto", async () => {
    givenHousehold({ switchedOn: [VIN], devices: [] });
    await expect(
      sendTestNotification({ subject: "ftp://nope.example", trigger: "manual" }),
    ).rejects.toThrow("Not a usable contact address for push");
  });

  it("refuses to run without the app's push keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    givenHousehold({ switchedOn: [VIN], devices: [] });
    await expect(send()).rejects.toThrow(
      "Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY",
    );
  });
});
