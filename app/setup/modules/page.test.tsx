// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../../lib/supabase/server";
import { switchTable } from "../../../test/module-switches";
import { chooseModules } from "./actions";
import ChooseModulesPage from "./page";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

afterEach(cleanup);

function given({ admin = true, chosen = false }: { admin?: boolean; chosen?: boolean } = {}) {
  const rpc = vi.fn(async (fn: string) => (fn === "has_permission" ? { data: admin, error: null } : { data: null, error: null }));
  vi.mocked(createClient).mockResolvedValue({
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "u1" } } }) },
    rpc,
    from: (table: string) => switchTable(table, { chosen }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return rpc;
}

// REQ-142: the last step of setting up a household.
describe("choosing a new household's modules", () => {
  it("lists every switch as a box, all ticked, Paperwork & Storage as one", async () => {
    given();
    render(await ChooseModulesPage());
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.closest("label")?.textContent)).toEqual([
      "Finances",
      "Calendar",
      "Pets",
      "Drinks",
      "Meal Plans",
      "Health",
      "Paperwork & Storage",
      "Restaurants",
    ]);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(within(screen.getByRole("main")).getByRole("button", { name: "Start using HomeBase" })).toBeTruthy();
  });

  it("is only for the admin, and only once", async () => {
    given({ admin: false });
    await expect(ChooseModulesPage()).rejects.toThrow("REDIRECT:/");
    given({ chosen: true });
    await expect(ChooseModulesPage()).rejects.toThrow("REDIRECT:/");
  });

  it("starts the unticked ones off, and nothing else, then goes Home", async () => {
    const rpc = given();
    const data = new FormData();
    for (const key of ["finances", "drinks", "meal-plans", "paperwork", "restaurants"]) data.append("module", key);
    await expect(chooseModules({}, data)).rejects.toThrow("REDIRECT:/");
    expect(rpc).toHaveBeenCalledWith("choose_modules", { left_out: ["calendar", "pets", "health"] });
  });

  it("says why, if the database refuses", async () => {
    const rpc = given();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "The household's modules are already chosen" } } as never);
    expect(await chooseModules({}, new FormData())).toEqual({ error: "The household's modules are already chosen" });
  });
});
