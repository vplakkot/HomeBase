import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listMembers, listRoles } from "./members";

const member = {
  user_id: "u1",
  name: "Sam",
  email: "sam@example.com",
  role_id: "r2",
  role_name: "Helper",
};

describe("listMembers", () => {
  it("asks the database's overview function and returns its rows", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: [member], error: null }),
    } as unknown as SupabaseClient;
    expect(await listMembers(supabase)).toEqual([member]);
    expect(supabase.rpc).toHaveBeenCalledWith("household_members_overview");
  });

  it("treats no rows as an empty roster, not a failure", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as SupabaseClient;
    expect(await listMembers(supabase)).toEqual([]);
  });

  it("throws when the database refuses", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    } as unknown as SupabaseClient;
    await expect(listMembers(supabase)).rejects.toThrow("boom");
  });
});

describe("listRoles", () => {
  it("reads roles as data, ordered by name", async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: "r1", name: "Helper" }], error: null });
    const select = vi.fn(() => ({ order }));
    const supabase = { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;
    expect(await listRoles(supabase)).toEqual([{ id: "r1", name: "Helper" }]);
    expect(supabase.from).toHaveBeenCalledWith("roles");
    expect(select).toHaveBeenCalledWith("id, name");
    expect(order).toHaveBeenCalledWith("name");
  });
});
