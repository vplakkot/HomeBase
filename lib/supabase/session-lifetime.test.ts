// @vitest-environment node
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const FOUR_HUNDRED_DAYS = 400 * 24 * 60 * 60;

// Staying signed in between opens of the installed app depends on the
// session cookies outliving the app being closed. A cookie with no lifetime
// is thrown away when the app closes (v0.1's admin mode relied on that,
// lesson 10), and it must not happen to the sign-in itself. The lifetime
// comes from @supabase/ssr's defaults, so this runs a real sign-in through
// our own client, with only Supabase's server faked, and reads what gets
// written.
describe("a sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.local");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(cookies).mockReset();
  });

  it("is kept for 400 days, so closing the app doesn't sign you out", async () => {
    const set = vi.fn();
    vi.mocked(cookies).mockResolvedValue({
      getAll: () => [],
      set,
    } as unknown as Awaited<ReturnType<typeof cookies>>);
    const now = Math.floor(Date.now() / 1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "fake-access-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now + 3600,
          refresh_token: "fake-refresh-token",
          user: {
            id: "00000000-0000-0000-0000-000000000001",
            aud: "authenticated",
            email: "member@example.com",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-09-19T00:00:00Z",
          },
        }),
      ),
    );

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: "member@example.com",
      password: "fake-password",
    });

    expect(error).toBeNull();
    const written = set.mock.calls.filter(([name]) =>
      String(name).startsWith("sb-"),
    );
    expect(written.length).toBeGreaterThan(0);
    for (const [, , options] of written) {
      expect(options).toMatchObject({ maxAge: FOUR_HUNDRED_DAYS });
    }
  });
});
