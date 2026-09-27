import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { saveMyName } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({ signedIn = true, error = null as { message: string } | null } = {}) {
  const auth = {
    getClaims: vi.fn().mockResolvedValue({ data: signedIn ? { claims: { sub: "u1" } } : null }),
    updateUser: vi.fn().mockResolvedValue({ data: {}, error }),
    refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({ auth } as unknown as Awaited<ReturnType<typeof createClient>>);
  return auth;
}

const named = (name: string) => {
  const data = new FormData();
  data.set("name", name);
  return data;
};

beforeEach(() => vi.mocked(revalidatePath).mockClear());

describe("setting your own name in Profile (REQ-124)", () => {
  it("saves it on your own account, then refreshes your sign-in so every page shows it", async () => {
    const auth = given();
    expect(await saveMyName({}, named("  Sam  Lee "))).toEqual({ saved: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { name: "Sam Lee" } });
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("doesn't save an empty or blank name", async () => {
    const auth = given();
    expect((await saveMyName({}, named("   "))).error).toMatch(/Type a name/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("says why when saving fails, and sends a signed-out visitor to sign in", async () => {
    given({ error: { message: "network down" } });
    expect(await saveMyName({}, named("Sam"))).toEqual({ error: "network down" });
    given({ signedIn: false });
    await expect(saveMyName({}, named("Sam"))).rejects.toThrow("REDIRECT:/sign-in");
  });
});
