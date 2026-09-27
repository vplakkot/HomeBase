import { NextResponse } from "next/server";
import { buildId } from "../../../lib/account";

// REQ-128: which build the server is running now, for an open app to
// compare with the one it was loaded with. It sits behind sign-in like
// every page (proxy.ts); signed out, the answer is the sign-in page, which
// the app reads as no news. Never cached, or the answer would go stale.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ build: buildId() }, { headers: { "Cache-Control": "no-store" } });
}
