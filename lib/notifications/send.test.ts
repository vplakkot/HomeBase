// @vitest-environment node
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "../supabase/admin";
import { hashReceiptToken } from "./receipt-token";
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

type LoggedRow = {
  trigger: string;
  user_id: string;
  device: string;
  receipt_hash: string;
};

function givenHousehold({
  switchedOn = [] as string[],
  devices = [] as Device[],
}) {
  const asked: { ids?: string[] } = {};
  const deleted: string[] = [];
  const logged: LoggedRow[] = [];
  const logUpdates: { token: string; fields: Record<string, unknown> }[] = [];
  const from = vi.fn((table: string) => {
    if (table === "notification_log") {
      return {
        insert: async (rows: LoggedRow[]) => {
          order.push("log");
          logged.push(...rows);
          return { error: null };
        },
        update: (fields: Record<string, unknown>) => ({
          eq: async (_column: string, token: string) => {
            logUpdates.push({ token, fields });
            return { error: null };
          },
        }),
      };
    }
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
  return { from, deleted, asked, logged, logUpdates };
}

const send = () =>
  sendTestNotification({ subject: "https://homebase.example", trigger: "hourly" });

// Shared by the fake database and the fake push library, so one test can
// prove the log row existed before the notification went out.
const order: string[] = [];

describe("sendTestNotification", () => {
  beforeEach(() => {
    order.length = 0;
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    vi.mocked(webpush.sendNotification).mockImplementation(async () => {
      order.push("send");
      return {} as Awaited<ReturnType<typeof webpush.sendNotification>>;
    });
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
    expect(JSON.parse(String(message))).toMatchObject({
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

  // REQ-22. The log row has to exist before the message goes out: a
  // notification can reach a phone and be reported back in well under a
  // second, and a receipt with no row to land on is simply lost.
  it("writes every log row before it sends anything", async () => {
    const { logged } = givenHousehold({
      switchedOn: [VIN, MEGAN],
      devices: [device(VIN, "vin-phone"), device(MEGAN, "megan-phone")],
    });
    await send();
    expect(order).toEqual(["log", "send", "send"]);
    expect(logged).toHaveLength(2);
    expect(logged.map((row) => row.user_id)).toEqual([VIN, MEGAN]);
    expect(logged.every((row) => row.trigger === "hourly")).toBe(true);
  });

  // The push address is what lets anyone send to the phone. The log keeps
  // a one-way fingerprint instead, so reading the log never hands over
  // the means to reach someone's device.
  it("logs a fingerprint of the device, never its address", async () => {
    const { logged } = givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "vin-phone")],
    });
    await send();
    expect(logged[0].device).not.toContain("web.push.apple.com");
    expect(logged[0].device).not.toContain("vin-phone");
    expect(logged[0].device).toMatch(/^[0-9a-f]{12}$/);
  });

  it("gives two devices different fingerprints, and the same device the same one", async () => {
    const { logged } = givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "vin-phone"), device(VIN, "vin-ipad")],
    });
    await send();
    const first = logged.map((row) => row.device);
    expect(first[0]).not.toBe(first[1]);

    vi.clearAllMocks();
    const again = givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "vin-phone")],
    });
    await send();
    expect(again.logged[0].device).toBe(first[0]);
  });

  // Each device gets its own secret, inside its own message. Sharing one
  // would let a receipt from any device answer for all of them.
  it("gives each device its own receipt token, and sends it only that one", async () => {
    const { logged } = givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "vin-phone"), device(VIN, "vin-ipad")],
    });
    await send();
    const sentTokens = vi
      .mocked(webpush.sendNotification)
      .mock.calls.map(([, message]) => JSON.parse(String(message)).receipt);
    expect(new Set(sentTokens).size).toBe(2);
    expect(sentTokens[0]).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(logged.map((row) => row.receipt_hash)).toEqual(
      sentTokens.map(hashReceiptToken),
    );
  });

  // An admin can read the log. If it held the tokens themselves, an admin
  // could quote one back and record a delivery that never happened —
  // exactly what the log exists to rule out.
  it("stores a hash of the token, never the token itself", async () => {
    const { logged } = givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "vin-phone")],
    });
    await send();
    const [, message] = vi.mocked(webpush.sendNotification).mock.calls[0];
    const sent = JSON.parse(String(message)).receipt;
    expect(logged[0].receipt_hash).not.toBe(sent);
    expect(logged[0].receipt_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(logged[0].receipt_hash).toBe(hashReceiptToken(sent));
  });

  it("marks a refused send against its own log row", async () => {
    const { logged, logUpdates } = givenHousehold({
      switchedOn: [VIN],
      devices: [device(VIN, "vin-phone"), device(VIN, "vin-ipad")],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce(new WebPushError("boom", 500, {} as never, "", ""))
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof webpush.sendNotification>>);
    await send();
    expect(logUpdates).toEqual([
      {
        token: logged[0].receipt_hash,
        fields: { accepted: false, failure_code: 500 },
      },
    ]);
  });

  it("refuses to run without the app's push keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    givenHousehold({ switchedOn: [VIN], devices: [] });
    await expect(send()).rejects.toThrow(
      "Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY",
    );
  });
});
