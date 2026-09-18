import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";
import { createMember } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({
  permission = true,
  createError = null,
}: {
  permission?: boolean;
  createError?: { message: string } | null;
} = {}) {
  vi.mocked(createClient).mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: permission, error: null }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  const admin = {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: {}, error: createError }),
        inviteUserByEmail: vi.fn(),
      },
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>,
  );
  return admin;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

const valid = { name: "Sam", email: "sam@example.com", temporaryPassword: "Temp-Pass-1!" };

describe("createMember", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(createAdminClient).mockReset();
  });

  it("requires a name, an email and a temporary password", async () => {
    const admin = given();
    const state = await createMember({}, form({ ...valid, email: "" }));
    expect(state.error).toBe("Name, email and a temporary password are all required.");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("refuses anyone without the manage_members permission", async () => {
    const admin = given({ permission: false });
    await expect(createMember({}, form(valid))).rejects.toThrow("REDIRECT:/");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("creates the account marked as admin-created, confirmed, and needing a new password", async () => {
    const admin = given();
    const state = await createMember({}, form(valid));
    expect(state).toEqual({ created: "sam@example.com" });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: "sam@example.com",
      password: "Temp-Pass-1!",
      email_confirm: true,
      user_metadata: { name: "Sam" },
      app_metadata: { created_by_admin: true, must_set_password: true },
    });
  });

  it("never sends an email: it creates the user directly rather than inviting", async () => {
    const admin = given();
    await createMember({}, form(valid));
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("shows why Supabase refused, for example a duplicate email", async () => {
    given({ createError: { message: "A user with this email address has already been registered" } });
    const state = await createMember({}, form(valid));
    expect(state.error).toBe("A user with this email address has already been registered");
  });
});
