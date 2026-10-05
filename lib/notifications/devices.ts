import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fingerprintOf } from "./send";

// REQ-160: the devices a person has signed up for notifications, as the
// screens show them. The push address never leaves the server: a device
// is named to the browser by its row's id only.

export type DeviceView = {
  id: string;
  // "iPhone, Safari": readable, not exact.
  name: string;
  addedAt: string;
  // The last time a notification reached it, from the log (which keeps 30
  // days); null when none has in that time.
  lastReceivedAt: string | null;
  thisDevice: boolean;
};

// Browser and device from the user-agent string saved when the device
// signed up. Order matters: Edge, Opera and Chrome on iPhone all say Safari.
export function deviceName(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(userAgent)
            ? "Mac"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  const browser = /Edg(e|A|iOS)?\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox|FxiOS/.test(userAgent)
        ? "Firefox"
        : /CriOS|Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent) || /AppleWebKit/.test(userAgent)
            ? "Safari"
            : null;
  if (device && browser) return `${device}, ${browser}`;
  return device ?? browser ?? "Unknown device";
}

type Row = { id: string; user_id: string; endpoint: string; user_agent: string | null; created_at: string };

// Each person's devices, oldest first. Needs the secret key, as the sender
// does: the log is closed to everyone but admins, and one person's devices
// are closed to everyone else, an admin included — here the admin console
// and the person themselves are the only callers.
export async function listDevices(
  admin: SupabaseClient,
  userIds: string[],
  thisEndpoint: string | null = null,
): Promise<Map<string, DeviceView[]>> {
  const byPerson = new Map<string, DeviceView[]>();
  if (userIds.length === 0) return byPerson;
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, user_agent, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the devices: ${error.message}`);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return byPerson;

  const { data: log, error: logError } = await admin
    .from("notification_log")
    .select("user_id, device, delivered_at")
    .in("user_id", userIds)
    .not("delivered_at", "is", null);
  if (logError) throw new Error(`Could not read the notification log: ${logError.message}`);
  const lastSeen = new Map<string, string>();
  for (const entry of (log ?? []) as { user_id: string; device: string; delivered_at: string }[]) {
    const key = `${entry.user_id} ${entry.device}`;
    const known = lastSeen.get(key);
    if (!known || entry.delivered_at > known) lastSeen.set(key, entry.delivered_at);
  }

  for (const row of rows) {
    const list = byPerson.get(row.user_id) ?? [];
    list.push({
      id: row.id,
      name: deviceName(row.user_agent),
      addedAt: row.created_at,
      lastReceivedAt: lastSeen.get(`${row.user_id} ${fingerprintOf(row.endpoint)}`) ?? null,
      thisDevice: thisEndpoint !== null && row.endpoint === thisEndpoint,
    });
    byPerson.set(row.user_id, list);
  }
  return byPerson;
}

// A one-way mark of a push address, for the removed-devices table.
export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

// Stops one device. The row goes, so the sender can no longer reach it,
// and its address is marked so the quiet sign-up that runs when the app
// opens on that phone doesn't put it back. Returns the address it removed,
// or null when there was no such device.
export async function removeDevice(admin: SupabaseClient, deviceId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("user_id, endpoint")
    .eq("id", deviceId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the device: ${error.message}`);
  if (!data) return null;
  const { user_id, endpoint } = data as { user_id: string; endpoint: string };
  const { error: markError } = await admin
    .from("removed_devices")
    .upsert({ endpoint_hash: endpointHash(endpoint), user_id }, { onConflict: "endpoint_hash" });
  if (markError) throw new Error(`Could not mark the device removed: ${markError.message}`);
  const { error: deleteError } = await admin.from("push_subscriptions").delete().eq("id", deviceId);
  if (deleteError) throw new Error(`Could not remove the device: ${deleteError.message}`);
  return endpoint;
}
