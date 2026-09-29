import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { setModuleOn } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({ permission = true }: { permission?: boolean } = {}) {
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const table = {
    delete: vi.fn(() => ({ eq: deleteEq })),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  const rpc = vi.fn().mockResolvedValue({ data: permission, error: null });
  const from = vi.fn((_table: string) => table);
  vi.mocked(createClient).mockResolvedValue({ rpc, from } as unknown as Awaited<ReturnType<typeof createClient>>);
  return { table, deleteEq, rpc, from };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

// REQ-141: the admin console's switches.
describe("turning a module on or off", () => {
  beforeEach(() => vi.clearAllMocks());

  it("turns a module off with a row, checking the admin's permission", async () => {
    const { table, rpc, from } = given();
    expect(await setModuleOn({}, form({ module: "drinks", on: "false" }))).toEqual({ on: false });
    expect(rpc).toHaveBeenCalledWith("has_permission", { permission: "manage_modules" });
    expect(from).toHaveBeenCalledWith("modules_off");
    expect(table.upsert).toHaveBeenCalledWith({ module: "drinks" }, { onConflict: "module", ignoreDuplicates: true });
    expect(table.delete).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("turns it back on by taking the row away, and touches nothing else", async () => {
    const { table, deleteEq, from } = given();
    expect(await setModuleOn({}, form({ module: "paperwork", on: "true" }))).toEqual({ on: true });
    expect(deleteEq).toHaveBeenCalledWith("module", "paperwork");
    expect(table.upsert).not.toHaveBeenCalled();
    expect(from.mock.calls.every(([name]) => name === "modules_off")).toBe(true);
  });

  it("has no switch of Storage's own: it goes with Paperwork", async () => {
    const { from } = given();
    expect(await setModuleOn({}, form({ module: "storage", on: "false" }))).toEqual({ error: "Which module?" });
    expect(from).not.toHaveBeenCalled();
  });

  it("sends anyone but an admin away", async () => {
    const { from } = given({ permission: false });
    await expect(setModuleOn({}, form({ module: "drinks", on: "false" }))).rejects.toThrow("REDIRECT:/");
    expect(from).not.toHaveBeenCalled();
  });
});
