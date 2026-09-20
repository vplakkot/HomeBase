import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import {
  hashReceiptToken,
  looksLikeAToken,
} from "../../../../lib/notifications/receipt-token";

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
// The most anyone holding a stolen token can do is claim that one
// notification arrived. Everyone else gets 204 and changes nothing.
//
// Worth naming rather than glossing: this address is open to the whole
// internet and has no rate limit, so anyone can make us do a little work
// for nothing. The blast radius is bounded — at most one row, and only
// the row whose token they already hold — but the request volume is not.
// That trade-off is recorded in the pull request rather than assumed
// away.

const EVENTS = ["delivered", "tapped"] as const;
type Event = (typeof EVENTS)[number];

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
  if (!looksLikeAToken(receipt)) {
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

  // The log stores a hash, never the token, so an admin reading it can't
  // quote one back. Matching means hashing what arrived the same way.
  const hash = hashReceiptToken(receipt);

  try {
    const admin = createAdminClient();
    // Only ever fills in a blank. The first report of each kind is the
    // honest one; a later repeat must not push the time forward.
    for (const [column, value] of Object.entries(fields)) {
      await admin
        .from("notification_log")
        .update({ [column]: value })
        .eq("receipt_hash", hash)
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
