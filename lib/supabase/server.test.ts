import { afterEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { createClient } from "./server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// During `next build` in CI there are no Supabase env vars. Asking for
// cookies() first marks the page dynamic, so the build skips prerendering
// it instead of failing on the env check. A build that ran the env check
// first is exactly what broke CI on PR #34.
describe("createClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(cookies).mockReset();
  });

  it("asks for cookies before it reads the env vars", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.mocked(cookies).mockRejectedValue(new Error("dynamic bailout"));

    await expect(createClient()).rejects.toThrow("dynamic bailout");
  });

  it("still fails clearly when the env vars are missing at request time", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.mocked(cookies).mockResolvedValue({
      getAll: () => [],
      set: () => {},
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    await expect(createClient()).rejects.toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });
});
