import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { listMembers } from "../../lib/auth/members";
import { changeMyEmail, saveMyName, setModuleHidden } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "homebase.example" })) }));
vi.mock("../../lib/auth/members", () => ({ listMembers: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({ signedIn = true, error = null as { message: string } | null } = {}) {
  const auth = {
    getClaims: vi.fn().mockResolvedValue({ data: signedIn ? { claims: { sub: "u1", email: "me@example.com" } } : null }),
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

// REQ-143: hiding a module is yours alone.
describe("hiding a module from your own view", () => {
  function withTable() {
    const deleteEq = vi.fn();
    const chain = { eq: deleteEq };
    deleteEq.mockReturnValue(chain);
    Object.assign(chain, { then: (resolve: (value: unknown) => unknown) => resolve({ error: null }) });
    const table = { upsert: vi.fn().mockResolvedValue({ error: null }), delete: vi.fn(() => chain) };
    const auth = { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "u1" } } }) };
    const from = vi.fn(() => table);
    vi.mocked(createClient).mockResolvedValue({ auth, from } as unknown as Awaited<ReturnType<typeof createClient>>);
    return { table, deleteEq, from };
  }
  const asked = (module: string, hidden: boolean) => {
    const data = new FormData();
    data.set("module", module);
    data.set("hidden", String(hidden));
    return data;
  };

  it("hides it with a row carrying your own ID", async () => {
    const { table, from } = withTable();
    expect(await setModuleHidden({}, asked("drinks", true))).toEqual({ hidden: true });
    expect(from).toHaveBeenCalledWith("modules_hidden");
    expect(table.upsert).toHaveBeenCalledWith(
      { user_id: "u1", module: "drinks" },
      { onConflict: "user_id,module", ignoreDuplicates: true },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("shows it again by taking away only your own row", async () => {
    const { deleteEq } = withTable();
    expect(await setModuleHidden({}, asked("drinks", false))).toEqual({ hidden: false });
    expect(deleteEq).toHaveBeenCalledWith("user_id", "u1");
    expect(deleteEq).toHaveBeenCalledWith("module", "drinks");
  });

  it("refuses a module that doesn't exist", async () => {
    const { from } = withTable();
    expect(await setModuleHidden({}, asked("garage", true))).toEqual({ error: "Which module?" });
    expect(from).not.toHaveBeenCalled();
  });
});

// REQ-158: your own email, from Profile.
describe("changing your own email in Profile (REQ-158)", () => {
  const typed = (email: string) => {
    const data = new FormData();
    data.set("email", email);
    return data;
  };
  beforeEach(() => {
    vi.mocked(listMembers).mockResolvedValue([
      { user_id: "u1", email: "me@example.com" },
      { user_id: "u2", email: "other@example.com" },
    ] as Awaited<ReturnType<typeof listMembers>>);
  });

  it("asks Supabase to confirm at the new address, which then emails only that address", async () => {
    const auth = given();
    expect(await changeMyEmail({}, typed(" New@Example.com "))).toEqual({
      sent: { address: "new@example.com", kind: "confirm" },
    });
    expect(auth.updateUser).toHaveBeenCalledWith(
      { email: "new@example.com" },
      { emailRedirectTo: "https://homebase.example/auth/confirm" },
    );
  });

  it("refuses something that isn't an address, and your current one", async () => {
    const auth = given();
    expect((await changeMyEmail({}, typed("nope"))).error).toMatch(/full email address/);
    expect(await changeMyEmail({}, typed("ME@example.com"))).toEqual({ error: "That is already your email." });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses an address another member already uses, with a clear message", async () => {
    const auth = given();
    expect(await changeMyEmail({}, typed("Other@example.com"))).toEqual({
      error: "That address already belongs to another account in this household.",
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("explains Supabase's own refusal in plain words, without its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    given({ error: { message: "SMTP failed at 10.1.1.1" } });
    expect((await changeMyEmail({}, typed("new@example.com"))).error).toBe("Couldn't send the email. Try again in a moment.");
  });

  it("sends someone signed out to sign in", async () => {
    given({ signedIn: false });
    await expect(changeMyEmail({}, typed("new@example.com"))).rejects.toThrow("REDIRECT:/sign-in");
  });
});
