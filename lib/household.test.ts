import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { householdExists } from "./household";

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as unknown as SupabaseClient;
}

describe("householdExists", () => {
  it("asks the database's household_exists function", async () => {
    const supabase = fakeClient({ data: true, error: null });
    await householdExists(supabase);
    expect(supabase.rpc).toHaveBeenCalledWith("household_exists");
  });

  it("is true when a household exists", async () => {
    expect(await householdExists(fakeClient({ data: true, error: null }))).toBe(
      true,
    );
  });

  it("is false when no household exists", async () => {
    expect(
      await householdExists(fakeClient({ data: false, error: null })),
    ).toBe(false);
  });

  it("throws rather than guessing when the check itself fails", async () => {
    await expect(
      householdExists(fakeClient({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });
});
