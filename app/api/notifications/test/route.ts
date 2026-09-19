import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sendTestNotification } from "../../../../lib/notifications/send";

// The hourly schedule's way in. It runs in the database, with no signed-in
// person, so it proves itself with a shared secret instead: the same value
// sits in Vercel as NOTIFY_SECRET and in Supabase's vault, where the
// schedule reads it. Nothing else here is reachable without signing in.
export async function POST(request: NextRequest) {
  const expected = process.env.NOTIFY_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Sending isn't set up on this server." },
      { status: 503 },
    );
  }

  const offered = /^Bearer (.+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!offered || !sameSecret(offered[1], expected)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }

  const summary = await sendTestNotification({
    // Our own address, which the push services want as a contact for the
    // app. Taken from the request, so it's right in every environment.
    subject: request.nextUrl.origin,
    trigger: "hourly",
  });
  return NextResponse.json(summary);
}

// Compared in constant time: a comparison that stops at the first wrong
// character tells an attacker, by how long it took, that the characters
// before it were right.
function sameSecret(offered: string, expected: string): boolean {
  const given = Buffer.from(offered);
  const real = Buffer.from(expected);
  return given.length === real.length && timingSafeEqual(given, real);
}
