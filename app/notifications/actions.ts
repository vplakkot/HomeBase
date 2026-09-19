"use server";

import { headers } from "next/headers";
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
  | { saved: false; error: string };

export async function saveDevice(
  subscription: DeviceSubscription,
): Promise<SaveDeviceResult> {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
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
    return { saved: false, error: `Couldn't save this device: ${error.message}` };
  }
  return { saved: true };
}
