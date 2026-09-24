import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// The database's schedules call the app with no signed-in person, so they
// prove themselves with a shared secret instead: the same value sits in
// Vercel as NOTIFY_SECRET and in Supabase's vault, where the schedules
// read it. Null when the caller knows it; otherwise the refusal to send.
export function refuseUnlessSchedule(request: NextRequest): NextResponse | null {
  const expected = process.env.NOTIFY_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Sending isn't set up on this server." }, { status: 503 });
  }
  const offered = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!offered || !sameSecret(offered[1], expected)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  return null;
}

// Compared in constant time: a comparison that stops at the first wrong
// character tells an attacker, by how long it took, that the characters
// before it were right.
function sameSecret(offered: string, expected: string): boolean {
  const given = Buffer.from(offered);
  const real = Buffer.from(expected);
  return given.length === real.length && timingSafeEqual(given, real);
}
