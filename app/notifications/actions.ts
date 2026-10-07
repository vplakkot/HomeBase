"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS } from "../../lib/notifications/device";
import { endpointHash, listDevices, removeDevice, type DeviceView } from "../../lib/notifications/devices";
import { MESSAGES, sendPush } from "../../lib/notifications/send";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";

// What a browser hands over when a device signs up for notifications
// (PushSubscription.toJSON()): the address its push service gave it, and
// the two keys a sender uses to encrypt a message only it can read.
export type DeviceSubscription = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export type SaveDeviceResult =
  | { saved: true }
  | { saved: false; error: string; takenByAnother?: true };

// Real ones are far shorter (an Apple address is under 300 characters, the
// keys under 100); the limits only stop a hand-crafted call storing junk.
const MAX_ENDPOINT = 2048;
const MAX_KEY = 256;

// Postgres error codes: row-level security refused the row, or the check
// on the address did.
const REFUSED_BY_RULES = "42501";
const NOT_A_PUSH_SERVICE = "23514";

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

// `quiet` is the sign-up the app does by itself when it opens on a phone
// that was turned on before. A device removed from the list (REQ-160) is
// not put back that way; turning notifications on by hand clears the mark.
export async function saveDevice(
  subscription: DeviceSubscription,
  options: { quiet?: boolean } = {},
): Promise<SaveDeviceResult> {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (
    !isText(endpoint, MAX_ENDPOINT) ||
    !isText(p256dh, MAX_KEY) ||
    !isText(auth, MAX_KEY)
  ) {
    return {
      saved: false,
      error: "That doesn't look like a device signing up for notifications.",
    };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return {
      saved: false,
      error: "Sign in again, then turn notifications on.",
    };
  }

  const removedBefore = await removedMark(endpoint, options.quiet === true);
  if (removedBefore === "stay-out") {
    return { saved: false, error: "This device was removed from the list." };
  }

  // No user_id is sent: the database fills in whoever is signed in, and
  // its rules refuse a row for anyone else. The same device signing up
  // again keeps its address, so it refreshes its row instead of adding one.
  const userAgent = (await headers()).get("user-agent");
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { endpoint, p256dh, auth, user_agent: userAgent },
      { onConflict: "endpoint" },
    );
  if (error) {
    // The details go to the server log; the person gets words they can use.
    console.error("saveDevice failed", error.code, error.message);
    if (error.code === REFUSED_BY_RULES) {
      return {
        saved: false,
        takenByAnother: true,
        error:
          "This device is already signed up for notifications under someone else in the household.",
      };
    }
    if (error.code === NOT_A_PUSH_SERVICE) {
      return {
        saved: false,
        error: "That notification address isn't from a push service HomeBase accepts.",
      };
    }
    return { saved: false, error: "Couldn't save this device. Try again in a moment." };
  }

  // Turning notifications on by hand also switches the person on in the
  // admin console, so the two never disagree. The quiet sign-up skips this:
  // it is not a decision, and must not undo an admin who switched them off.
  if (options.quiet !== true) await switchPersonOn(claimsUserId(data.claims));

  // Remember which device this browser is, so signing out can end
  // notifications for this one and leave their other devices alone.
  (await cookies()).set(DEVICE_COOKIE, endpoint, DEVICE_COOKIE_OPTIONS);
  return { saved: true };
}

function claimsUserId(claims: { sub?: unknown }): string | null {
  return typeof claims.sub === "string" ? claims.sub : null;
}

// The switch column is closed to signed-in people, so this uses the secret
// key. A failure is logged and the device stays saved: the person can still
// be switched on from the admin console.
async function switchPersonOn(userId: string | null) {
  if (!userId) return;
  try {
    const { error } = await createAdminClient()
      .from("household_members")
      .update({ notifications_enabled: true })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    revalidatePath("/admin");
  } catch (reason) {
    console.error("Could not switch notifications on", reason instanceof Error ? reason.message : reason);
  }
}

// Whether this address was removed from the list. A quiet sign-up must
// stay out when it was; a deliberate one clears the mark and goes on. The
// table is closed to signed-in people, so this uses the secret key. If it
// can't be read, the sign-up goes ahead: losing notifications is the worse
// way to be wrong.
async function removedMark(endpoint: string, quiet: boolean): Promise<"stay-out" | "go"> {
  try {
    const admin = createAdminClient();
    if (quiet) {
      const { data, error } = await admin
        .from("removed_devices")
        .select("endpoint_hash")
        .eq("endpoint_hash", endpointHash(endpoint))
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? "stay-out" : "go";
    }
    const { error } = await admin.from("removed_devices").delete().eq("endpoint_hash", endpointHash(endpoint));
    if (error) throw new Error(error.message);
  } catch (reason) {
    console.error("Could not check the removed devices", reason instanceof Error ? reason.message : reason);
  }
  return "go";
}

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub ?? null };
}

export type DeviceActionState = { error?: string; done?: string };

// Settings' own list: this person's devices, never anyone else's.
export async function myDevices(): Promise<DeviceView[]> {
  const { userId } = await signedIn();
  if (!userId) return [];
  const thisEndpoint = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
  const devices = await listDevices(createAdminClient(), [userId], thisEndpoint);
  return devices.get(userId) ?? [];
}

// Stops one of your own devices, held or not. The rows are checked as you
// (row-level security shows you only your own) before the secret key does
// the removal.
export async function removeMyDevice(deviceId: string): Promise<DeviceActionState> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { error: "Sign in again first." };
  const { data: mine, error } = await supabase.from("push_subscriptions").select("id").eq("id", deviceId).maybeSingle();
  if (error) return { error: error.message };
  if (!mine) return { error: "That device is already gone." };
  try {
    const endpoint = await removeDevice(createAdminClient(), deviceId);
    const store = await cookies();
    if (endpoint && store.get(DEVICE_COOKIE)?.value === endpoint) store.delete(DEVICE_COOKIE);
  } catch (reason) {
    console.error("Could not remove a device", reason);
    return { error: "Couldn't remove that device. Try again." };
  }
  revalidatePath("/admin");
  return { done: "Removed." };
}

// A test to one of your own devices, and no other.
export async function sendTestToMyDevice(deviceId: string): Promise<DeviceActionState> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { error: "Sign in again first." };
  const { data: mine, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint")
    .eq("id", deviceId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!mine) return { error: "That device is already gone." };
  const host = (await headers()).get("host");
  if (!host) return { error: "Couldn't work out this app's own address." };
  try {
    const summary = await sendPush({
      subject: `https://${host}`,
      trigger: "manual",
      to: [userId],
      onlyEndpoint: (mine as { endpoint: string }).endpoint,
      message: { ...MESSAGES.manual, url: "/" },
    });
    if (summary.people === 0) return { error: "Notifications are switched off for you, so nothing was sent." };
    return summary.delivered === 1 ? { done: "Sent." } : { error: "The test didn't go through." };
  } catch (reason) {
    console.error("Could not send a test notification", reason);
    return { error: "Couldn't send the test. Try again." };
  }
}
