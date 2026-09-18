import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import AdminPage from "./page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const roles = [
  { id: "role-a", name: "Chief" },
  { id: "role-b", name: "Helper" },
];
const members = [
  { user_id: "u1", name: null, email: "first@example.com", role_id: "role-a", role_name: "Chief" },
  { user_id: "u2", name: "Sam", email: "sam@example.com", role_id: "role-b", role_name: "Helper" },
];

function given({ signedIn, permissions = [] }: { signedIn: boolean; permissions?: string[] }) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: signedIn ? { claims: { sub: "u1" } } : null,
        error: null,
      }),
    },
    rpc: vi.fn(async (fn: string, args?: { permission: string }) => {
      if (fn === "has_permission") {
        return { data: permissions.includes(args?.permission ?? ""), error: null };
      }
      if (fn === "household_members_overview") {
        return { data: members, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    }),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: roles, error: null }),
      })),
    })),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("AdminPage", () => {
  afterEach(cleanup);

  it("sends a signed-out visitor to sign-in", async () => {
    given({ signedIn: false });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("refuses a member who types the URL", async () => {
    given({ signedIn: true, permissions: ["use_modules"] });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
  });

  it("lists every member with name, email and role", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("—")).toBeDefined();
    expect(within(rows[0]).getByText("first@example.com")).toBeDefined();
    expect(within(rows[1]).getByText("Sam")).toBeDefined();
    expect(within(rows[1]).getByText("sam@example.com")).toBeDefined();
    const samRole = screen.getByRole("combobox", { name: "Role for Sam" }) as HTMLSelectElement;
    expect(samRole.value).toBe("role-b");
    expect(within(samRole).getAllByRole("option").map((o) => o.textContent)).toEqual(["Chief", "Helper"]);
  });

  it("offers a role change and a password reset for each member", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    expect(screen.getAllByRole("button", { name: "Save role" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Reset password" })).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Temporary password for Sam" })).toBeDefined();
  });

  it("still offers the create-member form", async () => {
    given({ signedIn: true, permissions: ["manage_members"] });
    render(await AdminPage());
    expect(screen.getByLabelText("Name")).toBeDefined();
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create member" })).toBeDefined();
  });
});
