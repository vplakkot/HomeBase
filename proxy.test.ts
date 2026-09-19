// @vitest-environment node
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

type CookieToSet = { name: string; value: string; options?: object };
type SetAll = (cookies: CookieToSet[], headers?: Record<string, string>) => void;

function givenSupabase({
  signedIn,
  mustSetPassword = false,
  refreshedCookies = [],
}: {
  signedIn: boolean;
  mustSetPassword?: boolean;
  refreshedCookies?: CookieToSet[];
}) {
  vi.mocked(createServerClient).mockImplementation(
    (_url, _key, options) => {
      const setAll = (options?.cookies as { setAll?: SetAll } | undefined)?.setAll;
      return {
        auth: {
          getClaims: vi.fn(async () => {
            if (refreshedCookies.length > 0) {
              setAll?.(refreshedCookies, { "cache-control": "no-store" });
            }
            return {
              data: signedIn
                ? {
                    claims: {
                      sub: "user-1",
                      app_metadata: { must_set_password: mustSetPassword },
                    },
                  }
                : null,
              error: null,
            };
          }),
        },
      } as unknown as ReturnType<typeof createServerClient>;
    },
  );
}

function request(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.local");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(createServerClient).mockReset();
  });

  it("sends a signed-out visitor to sign-in", async () => {
    givenSupabase({ signedIn: false });
    const response = await proxy(request("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/sign-in");
  });

  it("lets a signed-out visitor reach sign-in and sign-up", async () => {
    givenSupabase({ signedIn: false });
    for (const path of ["/sign-in", "/sign-up"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("lets a signed-in member through and sends them home from sign-in", async () => {
    givenSupabase({ signedIn: true });
    expect((await proxy(request("/"))).headers.get("location")).toBeNull();
    expect((await proxy(request("/sign-in"))).headers.get("location")).toBe(
      "http://localhost:3000/",
    );
  });

  it("sends someone still on a temporary password to set a new one first", async () => {
    givenSupabase({ signedIn: true, mustSetPassword: true });
    expect((await proxy(request("/"))).headers.get("location")).toBe(
      "http://localhost:3000/set-password",
    );
    expect((await proxy(request("/admin"))).headers.get("location")).toBe(
      "http://localhost:3000/set-password",
    );
    expect((await proxy(request("/set-password"))).headers.get("location")).toBeNull();
  });

  it("keeps refreshed session cookies and cache headers on a redirect", async () => {
    givenSupabase({
      signedIn: true,
      refreshedCookies: [{ name: "sb-token", value: "fresh", options: { path: "/" } }],
    });
    const response = await proxy(request("/sign-in"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(response.cookies.get("sb-token")?.value).toBe("fresh");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  // The proxy is where a sign-in gets renewed, about once an hour of use. If
  // the renewed cookies lost their lifetime, the sign-in would be thrown
  // away the next time the installed app closed (lesson 13).
  it("keeps a renewed sign-in's 400-day lifetime, whether or not it redirects", async () => {
    const lifetime = 400 * 24 * 60 * 60;
    givenSupabase({
      signedIn: true,
      refreshedCookies: [
        { name: "sb-token", value: "fresh", options: { path: "/", maxAge: lifetime } },
      ],
    });
    for (const path of ["/", "/sign-in"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("set-cookie")).toContain(`Max-Age=${lifetime}`);
    }
  });

  it("verifies the token instead of trusting the cookie", async () => {
    givenSupabase({ signedIn: true });
    await proxy(request("/"));
    const client = vi.mocked(createServerClient).mock.results[0]?.value as {
      auth: { getClaims: unknown };
    };
    expect(client.auth.getClaims).toHaveBeenCalled();
  });

  it("skips static assets so they never pay for a token check", () => {
    const [pattern] = config.matcher;
    const regex = new RegExp(`^${pattern}$`);
    expect(regex.test("/_next/static/chunks/app.js")).toBe(false);
    expect(regex.test("/favicon.ico")).toBe(false);
    expect(regex.test("/logo.png")).toBe(false);
    expect(regex.test("/")).toBe(true);
    expect(regex.test("/sign-in")).toBe(true);
    expect(regex.test("/finances/2026")).toBe(true);
  });

  // A phone fetches these without the sign-in cookies. Sent through the
  // proxy, they'd come back as the sign-in page and the install would
  // ignore them.
  it("lets a phone fetch the app card and icons without signing in", () => {
    const [pattern] = config.matcher;
    const regex = new RegExp(`^${pattern}$`);
    for (const path of [
      "/manifest.webmanifest",
      "/apple-touch-icon.png",
      "/icon-192.png",
      "/icon-512.png",
    ]) {
      expect(regex.test(path)).toBe(false);
    }
  });

  // The phone re-checks the service worker in the background, and refuses
  // one that answers with a redirect, which is what a lapsed sign-in would
  // produce here.
  it("lets the phone fetch the service worker without signing in", () => {
    const [pattern] = config.matcher;
    const regex = new RegExp(`^${pattern}$`);
    expect(regex.test("/sw.js")).toBe(false);
  });

  // The skip list names exact files. Anything merely resembling one still
  // gets the sign-in check.
  it("still checks look-alikes of the skipped files", () => {
    const [pattern] = config.matcher;
    const regex = new RegExp(`^${pattern}$`);
    for (const path of [
      "/sw.json",
      "/sw-js",
      "/swXjs",
      "/manifest.webmanifest.bak",
      "/manifestXwebmanifest",
    ]) {
      expect(regex.test(path)).toBe(true);
    }
  });
});
