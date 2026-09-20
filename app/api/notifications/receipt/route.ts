import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

// REQ-22. Where a phone reports that a notification arrived, and that it
// was tapped.
//
// This address takes no session, and can't. A notification can land on a
// phone whose owner is signed out, and the service worker that reports it
// runs with no page and no person. What proves the report genuine is the
// receipt token: a long random secret that went to exactly one device,
// inside a message only that device could decrypt. Holding it is the
// proof.
//
// So the worst anyone without a token can do here is nothing, and the most
// anyone with a stolen token can do is claim that one notification arrived.

const EVENTS = ["delivered", "tapped"] as const;
type Event = (typeof EVENTS)[number];

// A receipt token is 32 random bytes in base64url. Anything far off that
// isn't worth a database round trip.
const TOKEN_LOOKS_RIGHT = /^[A-Za-z0-9_-]{16,128}$/;

export async function POST(request: Request) {
  // Always the same answer, whatever happened. A different reply for a
  // token that matched would turn this into a way to test tokens.
  const acknowledge = new NextResponse(null, { status: 204 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return acknowledge;
  }

  const { receipt, event } = (body ?? {}) as {
    receipt?: unknown;
    event?: unknown;
  };
  if (typeof receipt !== "string" || !TOKEN_LOOKS_RIGHT.test(receipt)) {
    return acknowledge;
  }
  if (typeof event !== "string" || !EVENTS.includes(event as Event)) {
    return acknowledge;
  }

  // A tap proves delivery too, and on iOS the tap can be the first thing
  // we hear about: the phone may show a notification without the service
  // worker getting a chance to report it.
  const now = new Date().toISOString();
  const fields =
    event === "tapped"
      ? { tapped_at: now, delivered_at: now }
      : { delivered_at: now };

  try {
    const admin = createAdminClient();
    // Only ever fills in a blank. The first report of each kind is the
    // honest one; a later repeat must not push the time forward.
    for (const [column, value] of Object.entries(fields)) {
      await admin
        .from("notification_log")
        .update({ [column]: value })
        .eq("receipt_token", receipt)
        .is(column, null);
    }
  } catch (reason) {
    // A lost receipt costs us one row's accuracy. It must never make the
    // phone retry or show an error.
    console.error(
      "Could not record a notification receipt",
      reason instanceof Error ? reason.message : reason,
    );
  }

  return acknowledge;
}
