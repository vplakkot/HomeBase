import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSwitchedOff, modulesChosen, readModuleView } from "./module-switches";

// A client whose tables answer with the given rows, or the given error.
function client(tables: Record<string, { data?: unknown[]; error?: { message: string } }>) {
  return {
    from: (table: string) => {
      const { data = [], error = null } = tables[table] ?? {};
      const result = { data: error ? null : data, error };
      const query: Record<string, unknown> = {
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
        maybeSingle: async () => ({ data: error ? null : (data[0] ?? null), error }),
      };
      query.select = () => query;
      query.eq = () => query;
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("reading the module switches", () => {
  afterEach(() => vi.restoreAllMocks());

  // REQ-141: Paperwork's switch is Storage's too.
  it("turns the switches that are off into the modules under them", async () => {
    const view = await readModuleView(
      client({ modules_off: { data: [{ module: "paperwork" }, { module: "pets" }] }, modules_hidden: { data: [{ module: "drinks" }] } }),
      "u1",
    );
    expect(view).toEqual({ off: ["pets", "paperwork", "storage"], hidden: ["drinks"] });
  });

  it("counts everything as on and shown if the switches can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await readModuleView(client({ modules_off: { error: { message: "no such table" } } }), "u1");
    expect(view).toEqual({ off: [], hidden: [] });
  });

  it("tells a scheduled job whether a module is off, and fails rather than guess", async () => {
    expect(await isSwitchedOff(client({ modules_off: { data: [{ module: "finances" }] } }), "finances")).toBe(true);
    expect(await isSwitchedOff(client({ modules_off: { data: [] } }), "finances")).toBe(false);
    await expect(isSwitchedOff(client({ modules_off: { error: { message: "down" } } }), "finances")).rejects.toThrow(
      "Could not read the module switches: down",
    );
  });

  // REQ-142.
  it("says whether the household's modules were chosen, counting unreadable as chosen", async () => {
    expect(await modulesChosen(client({ households: { data: [{ modules_chosen: false }] } }))).toBe(false);
    expect(await modulesChosen(client({ households: { data: [{ modules_chosen: true }] } }))).toBe(true);
    expect(await modulesChosen(client({ households: { error: { message: "down" } } }))).toBe(true);
  });
});
