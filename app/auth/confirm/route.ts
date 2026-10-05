import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { createClient } from "../../../lib/supabase/server";

// Where the link in an emailed message lands (REQ-158, #80). The email
// template carries a one-time token (token_hash), not a ready-made session,
// so it works from any browser: a phone's mail app opens it in Safari, not
// the installed app, and still gets through.
//
// recovery: the person forgot their password. Confirming signs them in and
//   sends them to choose a new one, through the same "must set a password"
//   step that follows a temporary one.
// email_change: the new address is confirmed; the change takes effect now.
//
// Not behind the sign-in proxy (it's left out of its matcher), because a
// person who is signed out has to be able to arrive here.
const TYPES = ["recovery", "email_change"] as const;
type LinkType = (typeof TYPES)[number];

function go(request: NextRequest, path: string) {
  const url = request.nextUrl.clone();
  const [pathname, search = ""] = path.split("?");
  url.pathname = pathname;
  url.search = search ? `?${search}` : "";
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as LinkType | null;
  if (!tokenHash || !type || !TYPES.includes(type)) {
    return go(request, "/sign-in?link=invalid");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    return go(request, "/sign-in?link=invalid");
  }

  if (type === "email_change") {
    return go(request, "/");
  }

  // Recovery: flag the account so the next step is choosing a password, then
  // take a fresh token that carries the flag.
  const { error: flagError } = await createAdminClient().auth.admin.updateUserById(data.user.id, {
    app_metadata: { must_set_password: true },
  });
  if (flagError) {
    await supabase.auth.signOut();
    return go(request, "/sign-in?link=invalid");
  }
  await supabase.auth.refreshSession();
  return go(request, "/set-password");
}
