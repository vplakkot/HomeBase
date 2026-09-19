import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";
import { changeRole, createMember, resetPassword } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({
  permission = true,
  inviteError = null,
  createError = null,
  updateError = null,
  adminUpdateError = null,
}: {
  permission?: boolean;
  inviteError?: { code?: string; message: string } | null;
  createError?: { message: string } | null;
  updateError?: { message: string } | null;
  adminUpdateError?: { message: string } | null;
} = {}) {
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const deleteLt = vi.fn().mockResolvedValue({ error: null });
  const invitations = {
    insert: vi.fn().mockResolvedValue({ error: inviteError }),
    delete: vi.fn(() => ({ eq: deleteEq, lt: deleteLt })),
  };
  const updateEq = vi.fn().mockResolvedValue({ error: updateError });
  const members = { update: vi.fn(() => ({ eq: updateEq })) };
  vi.mocked(createClient).mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: permission, error: null }),
    from: vi.fn((table: string) => {
      if (table === "member_invitations") return invitations;
      if (table === "household_members") return members;
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  const admin = {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: {}, error: createError }),
        updateUserById: vi.fn().mockResolvedValue({ data: {}, error: adminUpdateError }),
        inviteUserByEmail: vi.fn(),
      },
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>,
  );
  return { admin, invitations, deleteEq, deleteLt, members, updateEq };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("createMember", () => {
  const valid = { name: "Sam", email: "Sam@Example.com ", temporaryPassword: "Temp-Pass-1!" };

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
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("never sends an email: it creates the user directly rather than inviting", async () => {
    const { admin } = given();
    await createMember({}, form(valid));
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("clears expired invitations before writing a new one", async () => {
    const { invitations, deleteLt } = given();
    await createMember({}, form(valid));
    expect(deleteLt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(invitations.delete.mock.invocationCallOrder[0]).toBeLessThan(
      invitations.insert.mock.invocationCallOrder[0],
    );
  });

  it("stops if the invitation can't be written, and explains a duplicate", async () => {
    const { admin } = given({ inviteError: { code: "23505", message: "duplicate key value" } });
    const state = await createMember({}, form(valid));
    expect(state.error).toBe(
      "An invitation for that email is already waiting to be used. If an earlier attempt failed, it clears itself within ten minutes.",
    );
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

describe("changeRole", () => {
  it("refuses anyone without the manage_members permission", async () => {
    const { members } = given({ permission: false });
    await expect(changeRole({}, form({ userId: "u1", roleId: "r1" }))).rejects.toThrow("REDIRECT:/");
    expect(members.update).not.toHaveBeenCalled();
  });

  it("updates the membership row and refreshes the console", async () => {
    const { members, updateEq } = given();
    const state = await changeRole({}, form({ userId: "u1", roleId: "r2" }));
    expect(state).toEqual({ saved: true });
    expect(members.update).toHaveBeenCalledWith({ role_id: "r2" });
    expect(updateEq).toHaveBeenCalledWith("user_id", "u1");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("shows the database's refusal as-is (holder limits live there)", async () => {
    given({ updateError: { message: "This role must keep at least 1 holder(s)" } });
    const state = await changeRole({}, form({ userId: "u1", roleId: "r2" }));
    expect(state.error).toBe("This role must keep at least 1 holder(s)");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  it("refuses anyone without the manage_members permission", async () => {
    const { admin } = given({ permission: false });
    await expect(
      resetPassword({}, form({ userId: "u1", temporaryPassword: "Temp-Pass-1!" })),
    ).rejects.toThrow("REDIRECT:/");
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("insists on at least 8 characters", async () => {
    const { admin } = given();
    const state = await resetPassword({}, form({ userId: "u1", temporaryPassword: "short" }));
    expect(state.error).toBe("Use at least 8 characters for the temporary password.");
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("sets the temporary password and the must-change flag in one call", async () => {
    const { admin } = given();
    const state = await resetPassword({}, form({ userId: "u1", temporaryPassword: "Temp-Pass-1!" }));
    expect(state).toEqual({ reset: true });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith("u1", {
      password: "Temp-Pass-1!",
      app_metadata: { must_set_password: true },
    });
  });

  it("shows why Supabase refused", async () => {
    given({ adminUpdateError: { message: "User not found" } });
    const state = await resetPassword({}, form({ userId: "u1", temporaryPassword: "Temp-Pass-1!" }));
    expect(state.error).toBe("User not found");
  });
});
