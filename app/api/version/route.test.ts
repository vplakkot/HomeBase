import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("the version address (REQ-128)", () => {
  it("names the commit this server was built from, never cached", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    const reply = GET();
    expect(await reply.json()).toEqual({ build: "abcdef1234567890" });
    expect(reply.headers.get("Cache-Control")).toBe("no-store");
  });

  it("says local off Vercel", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    expect(await GET().json()).toEqual({ build: "local" });
  });
});
