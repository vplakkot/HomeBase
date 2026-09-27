import { NextResponse, type NextRequest } from "next/server";
import { hasPermission } from "../../../lib/auth/permissions";
import { PHOTO_NAME, placesFromEnv } from "../../../lib/restaurants/places";
import { createClient } from "../../../lib/supabase/server";

// A place's photo (REQ-90, REQ-129). Asking Google for a photo takes the
// key, so the browser asks here instead: this swaps Google's name for the
// photo (places/…/photos/…) for Google's own image link, which carries no
// key, and sends the browser there. Only a household member who can use
// the modules can ask, so nobody else can spend our Google allowance.
//
// The phone keeps the answer for a day: each photo Google hands out is
// charged, and a tile shouldn't cost one every time the list is opened.
const WIDTHS = new Set([400, 800]);

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") ?? "";
  const width = Number(request.nextUrl.searchParams.get("w") ?? 400);
  if (!PHOTO_NAME.test(name) || !WIDTHS.has(width)) return new NextResponse(null, { status: 400 });

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return new NextResponse(null, { status: 401 });
  if (!(await hasPermission(supabase, "use_modules"))) return new NextResponse(null, { status: 403 });

  const places = placesFromEnv();
  const link = places ? await places.photoLink(name, width).catch(() => null) : null;
  if (!link) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 302,
    headers: { Location: link, "Cache-Control": "private, max-age=86400" },
  });
}
