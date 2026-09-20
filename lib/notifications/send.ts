import { createHash, randomBytes } from "node:crypto";
import webpush, { WebPushError } from "web-push";
import { createAdminClient } from "../supabase/admin";

// Who gets a test notification, and what happened to each device. The
// switch and the devices are both readable only by their owner, and a
// scheduled job has no signed-in person, so this runs with the secret key
// — the only route to them, as REQ-16 and REQ-20 noted.

export type Trigger = "hourly" | "manual";

export type DeviceOutcome = {
  userId: string;
  endpoint: string;
  delivered: boolean;
  statusCode?: number;
  // The push service says this address no longer exists, so its row went.
  removed?: true;
};

export type SendSummary = {
  trigger: Trigger;
  people: number;
  devices: number;
  delivered: number;
  failed: number;
  removed: number;
  outcomes: DeviceOutcome[];
};

type Device = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export const MESSAGES: Record<Trigger, { title: string; body: string }> = {
  hourly: { title: "HomeBase", body: "Hourly test notification." },
  manual: { title: "HomeBase", body: "Test notification, sent by hand." },
};

// Half an hour: a test notification that arrives later than that has
// already failed its purpose, and a stale one is worse than none.
export const KEEP_TRYING_FOR = 30 * 60;

// An address the push service says is finished with. Its row goes, so the
// table doesn't fill with devices nothing can be delivered to.
const GONE = [404, 410];

export async function sendTestNotification({
  subject,
  trigger,
}: {
  // Who to contact about this app, as the push services require: our own
  // address, never a person's.
  subject: string;
  trigger: Trigger;
}): Promise<SendSummary> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY",
    );
  }
  webpush.setVapidDetails(contactAddress(subject), publicKey, privateKey);

  const admin = createAdminClient();
  const { data: switchedOn, error: membersError } = await admin
    .from("household_members")
    .select("user_id")
    .eq("notifications_enabled", true);
  if (membersError) {
    throw new Error(`Could not read who is switched on: ${membersError.message}`);
  }

  const people = (switchedOn ?? []).map((member) => member.user_id as string);
  if (people.length === 0) {
    return empty(trigger);
  }

  const { data: devices, error: devicesError } = await admin
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", people);
  if (devicesError) {
    throw new Error(`Could not read the devices: ${devicesError.message}`);
  }

  // Each device gets its own secret, handed to it inside its own message,
  // which it sends back to report the delivery (REQ-22).
  const addressed = ((devices ?? []) as Device[]).map((device) => ({
    device,
    receiptToken: randomBytes(32).toString("base64url"),
    fingerprint: fingerprintOf(device.endpoint),
  }));

  // The log rows go in BEFORE anything is sent. A notification can reach a
  // phone and be reported back in well under a second, and a receipt that
  // arrives before its row exists has nowhere to land.
  if (addressed.length > 0) {
    const { error: logError } = await admin.from("notification_log").insert(
      addressed.map(({ device, receiptToken, fingerprint }) => ({
        trigger,
        user_id: device.user_id,
        device: fingerprint,
        receipt_token: receiptToken,
      })),
    );
    // Losing the log must never stop the notifications themselves. The
    // log is for judging reliability; the sending is the point.
    if (logError) {
      console.error("Could not write the notification log", logError.message);
    }
  }

  const outcomes = await Promise.all(
    addressed.map(({ device, receiptToken }) =>
      sendToOne(device, receiptToken, trigger, admin),
    ),
  );

  return {
    trigger,
    people: people.length,
    devices: outcomes.length,
    delivered: outcomes.filter((outcome) => outcome.delivered).length,
    failed: outcomes.filter((outcome) => !outcome.delivered).length,
    removed: outcomes.filter((outcome) => outcome.removed).length,
    outcomes,
  };
}

// The push services accept only an https: or mailto: contact address, and
// refuse anything else outright. On this laptop the app's own address is
// http://localhost:3000, so it is written as https here. Nothing fetches
// it; it is a note saying which app is calling.
function contactAddress(subject: string): string {
  const contact = subject.replace(/^http:\/\//, "https://");
  if (!contact.startsWith("https://") && !contact.startsWith("mailto:")) {
    throw new Error(`Not a usable contact address for push: ${subject}`);
  }
  return contact;
}

// A stable name for a device that isn't its address. The address is what
// lets anyone send to the phone; this is a one-way hash of it, so the log
// can follow one device over time without holding the means to reach it.
function fingerprintOf(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 12);
}

async function sendToOne(
  device: Device,
  receiptToken: string,
  trigger: Trigger,
  admin: ReturnType<typeof createAdminClient>,
): Promise<DeviceOutcome> {
  const subscription = {
    endpoint: device.endpoint,
    keys: { p256dh: device.p256dh, auth: device.auth },
  };
  const message = JSON.stringify({
    ...MESSAGES[trigger],
    url: "/",
    receipt: receiptToken,
  });
  try {
    await webpush.sendNotification(subscription, message, {
      TTL: KEEP_TRYING_FOR,
    });
    return { userId: device.user_id, endpoint: device.endpoint, delivered: true };
  } catch (reason) {
    const statusCode =
      reason instanceof WebPushError ? reason.statusCode : undefined;
    // One device failing must never stop the others.
    console.error(
      "Could not send a notification",
      statusCode,
      reason instanceof Error ? reason.message : reason,
    );
    // Correct the log row, which was written before the attempt.
    await admin
      .from("notification_log")
      .update({ accepted: false, failure_code: statusCode ?? null })
      .eq("receipt_token", receiptToken);
    if (statusCode !== undefined && GONE.includes(statusCode)) {
      await admin
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", device.endpoint);
      return {
        userId: device.user_id,
        endpoint: device.endpoint,
        delivered: false,
        statusCode,
        removed: true,
      };
    }
    return {
      userId: device.user_id,
      endpoint: device.endpoint,
      delivered: false,
      statusCode,
    };
  }
}

function empty(trigger: Trigger): SendSummary {
  return {
    trigger,
    people: 0,
    devices: 0,
    delivered: 0,
    failed: 0,
    removed: 0,
    outcomes: [],
  };
}
