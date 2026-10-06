import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { createAdminClient } from "../../../lib/supabase/admin";
import { createClient } from "../../../lib/supabase/server";
import { GET } from "./route";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

function given({ verifyError = null as { message: string } | null, flagError = null as { message: string } | null } = {}) {
  const auth = {
    verifyOtp: vi.fn().mockResolvedValue({ data: { user: verifyError ? null : { id: "u1" } }, error: verifyError }),
    refreshSession: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({ auth } as unknown as Awaited<ReturnType<typeof createClient>>);
  const updateUserById = vi.fn().mockResolvedValue({ error: flagError });
  const deleteDevices = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ delete: () => ({ eq: deleteDevices }) }));
  vi.mocked(createAdminClient).mockReturnValue({ auth: { admin: { updateUserById } }, from } as unknown as ReturnType<typeof createAdminClient>);
  const deleteCookie = vi.fn();
  vi.mocked(cookies).mockResolvedValue({ delete: deleteCookie } as unknown as Awaited<ReturnType<typeof cookies>>);
  return { auth, updateUserById, from, deleteDevices, deleteCookie };
}

const visit = (query: string) => GET(new NextRequest(`https://homebase.example/auth/confirm?${query}`));
const where = (response: Response) => {
  const url = new URL(response.headers.get("location") ?? "");
  return url.pathname + url.search;
};

beforeEach(() => vi.mocked(createClient).mockReset());

describe("the emailed link (/auth/confirm)", () => {
  it("recovery: signs the person in, flags the account, takes a fresh token, and goes to choose a password", async () => {
    const { auth, updateUserById } = given();
    const response = await visit("token_hash=abc&type=recovery");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc" });
    expect(updateUserById).toHaveBeenCalledWith("u1", { app_metadata: { must_set_password: true } });
    expect(auth.refreshSession).toHaveBeenCalled();
    expect(where(response)).toBe("/set-password");
  });

  it("email_change: confirms the new address, then ends every session and asks for a fresh sign-in", async () => {
    const { auth, updateUserById } = given();
    const response = await visit("token_hash=abc&type=email_change");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email_change", token_hash: "abc" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(where(response)).toBe("/sign-in?link=email-changed");
  });

  it("email_change: also clears the person's notification devices and this browser's note", async () => {
    const { from, deleteDevices, deleteCookie } = given();
    await visit("token_hash=abc&type=email_change");
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(deleteDevices).toHaveBeenCalledWith("user_id", "u1");
    expect(deleteCookie).toHaveBeenCalledWith("homebase-device");
  });

  it("email_change: a link that doesn't verify ends nothing", async () => {
    const { auth, from } = given({ verifyError: { message: "expired" } });
    await visit("token_hash=abc&type=email_change");
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("an expired or used link goes to sign-in with a note", async () => {
    given({ verifyError: { message: "Email link is invalid or has expired" } });
    expect(where(await visit("token_hash=abc&type=recovery"))).toBe("/sign-in?link=invalid");
  });

  it("refuses a missing token or any other type, without asking Supabase", async () => {
    const { auth } = given();
    expect(where(await visit("type=recovery"))).toBe("/sign-in?link=invalid");
    expect(where(await visit("token_hash=abc&type=magiclink"))).toBe("/sign-in?link=invalid");
    expect(where(await visit("token_hash=abc"))).toBe("/sign-in?link=invalid");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("never leaves someone signed in on a recovery whose flag couldn't be set", async () => {
    const { auth } = given({ flagError: { message: "boom" } });
    expect(where(await visit("token_hash=abc&type=recovery"))).toBe("/sign-in?link=invalid");
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("only ever goes to its own fixed places, whatever else is in the address", async () => {
    given();
    expect(where(await visit("token_hash=abc&type=email_change&next=https://evil.example"))).toBe(
      "/sign-in?link=email-changed",
    );
  });
});
