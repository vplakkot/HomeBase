import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "./admin";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({})) }));

describe("createAdminClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(createSupabaseClient).mockClear();
  });

  it("refuses to start without the server-side secret key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.local");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(() => createAdminClient()).toThrow("SUPABASE_SECRET_KEY");
  });

  it("never keeps or refreshes a session of its own", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.local");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    createAdminClient();
    expect(createSupabaseClient).toHaveBeenCalledWith(
      "http://supabase.local",
      "sb_secret_test",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });
});
