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

export async function saveDevice(
  subscription: DeviceSubscription,
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
  return { saved: true };
}
