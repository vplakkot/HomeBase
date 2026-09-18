import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { hasPermission } from "./permissions";

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as unknown as SupabaseClient;
}

describe("hasPermission", () => {
  it("asks the database's has_permission function for that permission", async () => {
    const supabase = fakeClient({ data: true, error: null });
    await hasPermission(supabase, "manage_members");
    expect(supabase.rpc).toHaveBeenCalledWith("has_permission", {
      permission: "manage_members",
    });
  });

  it("is true when the caller's role carries the permission", async () => {
    expect(
      await hasPermission(fakeClient({ data: true, error: null }), "use_modules"),
    ).toBe(true);
  });

  it("is false when it doesn't", async () => {
    expect(
      await hasPermission(fakeClient({ data: false, error: null }), "manage_roles"),
    ).toBe(false);
  });

  it("throws rather than guessing when the check itself fails", async () => {
    await expect(
      hasPermission(
        fakeClient({ data: null, error: { message: "boom" } }),
        "manage_members",
      ),
    ).rejects.toThrow("boom");
  });
});
