import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE } from "../../../lib/notifications/device";
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
//   Then every session on the account ends, this browser's too, and the
//   person signs in again with the new address and their password. The
//   address is how they sign in, so changing it is a reason to prove they
//   still know the password; and an old session left open elsewhere (a
//   phone handed on, a stolen cookie) must not outlive the change.
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
    // Ends every session on the account, including the one this link just made.
    const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
    if (signOutError) console.error("Could not end the sessions after an email change", signOutError.message);
    // Their devices were signed up for notifications under sessions that no
    // longer exist, and a device signed out must stop receiving (lesson 14),
    // so they go too. Signing in again, they turn notifications back on.
    const { error: devicesError } = await createAdminClient()
      .from("push_subscriptions")
      .delete()
      .eq("user_id", data.user.id);
    if (devicesError) console.error("Could not clear the devices after an email change", devicesError.message);
    (await cookies()).delete(DEVICE_COOKIE);
    return go(request, "/sign-in?link=email-changed");
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
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    // Without the flag in the token, /set-password would bounce them Home
    // and they'd never be asked for a password.
    await supabase.auth.signOut();
    return go(request, "/sign-in?link=invalid");
  }
  return go(request, "/set-password");
}
