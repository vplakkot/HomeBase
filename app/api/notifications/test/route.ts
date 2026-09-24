import { NextResponse, type NextRequest } from "next/server";
import { sendTestNotification } from "../../../../lib/notifications/send";
import { refuseUnlessSchedule } from "../../../../lib/notifications/schedule-auth";

// The hourly schedule's way in. Nothing else here is reachable without
// signing in, so it proves itself with the shared secret.
export async function POST(request: NextRequest) {
  const refused = refuseUnlessSchedule(request);
  if (refused) return refused;

  const { outcomes, ...counts } = await sendTestNotification({
    // Our own address, which the push services want as a contact for the
    // app. Taken from the request, so it's right in every environment.
    subject: request.nextUrl.origin,
    trigger: "hourly",
  });
  // Counts only. pg_net keeps every answer it receives for hours, and
  // there's no reason to copy each device's address into that table once
  // an hour, for ever.
  void outcomes;
  return NextResponse.json(counts);
}
