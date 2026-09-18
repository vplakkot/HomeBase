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
  inviteError = null,
  createError = null,
}: {
  permission?: boolean;
  inviteError?: { code?: string; message: string } | null;
  createError?: { message: string } | null;
} = {}) {
  const invitations = {
    insert: vi.fn().mockResolvedValue({ error: inviteError }),
    delete: vi.fn(() => ({ eq: deleteEq })),
  };
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  vi.mocked(createClient).mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: permission, error: null }),
    from: vi.fn((table: string) => {
      if (table !== "member_invitations") throw new Error(`unexpected table ${table}`);
      return invitations;
    }),
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
  return { admin, invitations, deleteEq };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

const valid = { name: "Sam", email: "Sam@Example.com ", temporaryPassword: "Temp-Pass-1!" };

describe("createMember", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(createAdminClient).mockReset();
  });

  it("requires a name, an email and a temporary password", async () => {
    const { admin, invitations } = given();
    const state = await createMember({}, form({ ...valid, email: "" }));
    expect(state.error).toBe("Name, email and a temporary password are all required.");
    expect(invitations.insert).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("refuses anyone without the manage_members permission", async () => {
    const { admin, invitations } = given({ permission: false });
    await expect(createMember({}, form(valid))).rejects.toThrow("REDIRECT:/");
    expect(invitations.insert).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("writes the invitation first, lowercased, then creates the account", async () => {
    const { admin, invitations } = given();
    const state = await createMember({}, form(valid));
    expect(state).toEqual({ created: "sam@example.com" });
    expect(invitations.insert).toHaveBeenCalledWith({ email: "sam@example.com" });
    expect(invitations.insert.mock.invocationCallOrder[0]).toBeLessThan(
      admin.auth.admin.createUser.mock.invocationCallOrder[0],
    );
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: "sam@example.com",
      password: "Temp-Pass-1!",
      email_confirm: true,
      user_metadata: { name: "Sam" },
      app_metadata: { must_set_password: true },
    });
  });

  it("never sends an email: it creates the user directly rather than inviting", async () => {
    const { admin } = given();
    await createMember({}, form(valid));
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("stops if the invitation can't be written, and explains a duplicate", async () => {
    const { admin } = given({ inviteError: { code: "23505", message: "duplicate key value" } });
    const state = await createMember({}, form(valid));
    expect(state.error).toBe("An invitation for that email is already waiting to be used.");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("removes the invitation again if Supabase refuses the account", async () => {
    const { deleteEq } = given({
      createError: { message: "A user with this email address has already been registered" },
    });
    const state = await createMember({}, form(valid));
    expect(state.error).toBe("A user with this email address has already been registered");
    expect(deleteEq).toHaveBeenCalledWith("email", "sam@example.com");
  });
});
