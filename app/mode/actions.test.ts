import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_COOKIE } from "../../lib/auth/mode";
import { createClient } from "../../lib/supabase/server";
import { enterAdminMode, leaveAdminMode } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function givenPermission(held: boolean) {
  vi.mocked(createClient).mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: held, error: null }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function fakeCookieStore() {
  const store = { set: vi.fn(), delete: vi.fn() };
  vi.mocked(cookies).mockResolvedValue(
    store as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  return store;
}

describe("enterAdminMode", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(cookies).mockReset();
  });

  it("refuses anyone without the manage_members permission", async () => {
    givenPermission(false);
    const store = fakeCookieStore();
    await expect(enterAdminMode()).rejects.toThrow("REDIRECT:/");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("sets a session-only cookie for a permission holder and sends them home", async () => {
    givenPermission(true);
    const store = fakeCookieStore();
    await expect(enterAdminMode()).rejects.toThrow("REDIRECT:/");
    expect(store.set).toHaveBeenCalledWith(
      MODE_COOKIE,
      "admin",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
    const options = store.set.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options).not.toHaveProperty("maxAge");
    expect(options).not.toHaveProperty("expires");
  });
});

describe("leaveAdminMode", () => {
  it("clears the cookie and sends the admin home", async () => {
    const store = fakeCookieStore();
    await expect(leaveAdminMode()).rejects.toThrow("REDIRECT:/");
    expect(store.delete).toHaveBeenCalledWith(MODE_COOKIE);
  });
});
