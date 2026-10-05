import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// A client that keeps nothing: no cookies, no stored session. For acting as
// somebody for one request (asking Supabase to send an email, or confirming
// a link) without signing anyone in on this server's own cookies.
export function createEphemeralClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
