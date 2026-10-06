import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "../../lib/supabase/admin";
import { headers } from "next/headers";
import { removeDevice } from "../../lib/notifications/devices";
import { sendPush, sendTestNotification } from "../../lib/notifications/send";
import { createClient } from "../../lib/supabase/server";
import { listMembers } from "../../lib/auth/members";
import { createEphemeralClient } from "../../lib/supabase/ephemeral";
import {
  changeMemberEmail,
  changeRole,
  createMember,
  renameMember,
  resetPassword,
  removeMemberDevice,
  sendTestNow,
  sendTestToMember,
  setGoogleEmail,
  setNotifications,
} from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("../../lib/notifications/send", () => ({
  sendTestNotification: vi.fn(),
  sendPush: vi.fn(),
  MESSAGES: { manual: { title: "HomeBase", body: "Test notification, sent by hand." } },
}));
vi.mock("../../lib/notifications/devices", () => ({ removeDevice: vi.fn() }));
vi.mock("../../lib/auth/members", () => ({ listMembers: vi.fn() }));
vi.mock("../../lib/supabase/ephemeral", () => ({ createEphemeralClient: vi.fn() }));
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
        getUserById: vi.fn(),
        generateLink: vi.fn(),
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

describe("setGoogleEmail (REQ-152)", () => {
  it("refuses anyone without the manage_members permission", async () => {
    const { members } = given({ permission: false });
    await expect(setGoogleEmail({}, form({ userId: "u1", googleEmail: "a@example.com" }))).rejects.toThrow("REDIRECT:/");
    expect(members.update).not.toHaveBeenCalled();
  });

  it("saves the address, tidied, on the member's own row", async () => {
    const { members, updateEq } = given();
    expect(await setGoogleEmail({}, form({ userId: "u1", googleEmail: "  Alex@Example.com " }))).toEqual({ saved: true });
    expect(members.update).toHaveBeenCalledWith({ google_email: "alex@example.com" });
    expect(updateEq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("clears it when left empty, since it's optional", async () => {
    const { members } = given();
    expect(await setGoogleEmail({}, form({ userId: "u1", googleEmail: "" }))).toEqual({ saved: true });
    expect(members.update).toHaveBeenCalledWith({ google_email: null });
  });

  it("refuses something that isn't an email address", async () => {
    const { members } = given();
    const state = await setGoogleEmail({}, form({ userId: "u1", googleEmail: "alex" }));
    expect(state.error).toMatch(/full email address/);
    expect(members.update).not.toHaveBeenCalled();
  });
});

describe("setNotifications", () => {
  it("refuses anyone without the manage_members permission", async () => {
    const { members } = given({ permission: false });
    await expect(
      setNotifications({}, form({ userId: "u1", enabled: "true" })),
    ).rejects.toThrow("REDIRECT:/");
    expect(members.update).not.toHaveBeenCalled();
  });

  it("turns the switch on for that member and refreshes the console", async () => {
    const { members, updateEq } = given();
    const state = await setNotifications({}, form({ userId: "u1", enabled: "true" }));
    expect(state).toEqual({ enabled: true });
    expect(members.update).toHaveBeenCalledWith({ notifications_enabled: true });
    expect(updateEq).toHaveBeenCalledWith("user_id", "u1");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("turns it off again", async () => {
    const { members } = given();
    const state = await setNotifications({}, form({ userId: "u1", enabled: "false" }));
    expect(state).toEqual({ enabled: false });
    expect(members.update).toHaveBeenCalledWith({ notifications_enabled: false });
  });

  it("treats anything that isn't the word true as off, never as a toggle", async () => {
    const { members } = given();
    await setNotifications({}, form({ userId: "u1", enabled: "" }));
    expect(members.update).toHaveBeenCalledWith({ notifications_enabled: false });
  });

  it("needs to know which member", async () => {
    const { members } = given();
    const state = await setNotifications({}, form({ enabled: "true" }));
    expect(state.error).toBe("Which member?");
    expect(members.update).not.toHaveBeenCalled();
  });

  it("shows the database's refusal as-is", async () => {
    given({ updateError: { message: "permission denied for table household_members" } });
    const state = await setNotifications({}, form({ userId: "u1", enabled: "true" }));
    expect(state.error).toBe("permission denied for table household_members");
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

describe("renameMember (REQ-124)", () => {
  // The admin's own client: whether they may manage members, which ids are
  // in the household, and who they are.
  function asAdmin({ permission = true, inHousehold = true, self = "admin-1" } = {}) {
    const { admin } = given({ permission });
    const auth = {
      getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: self } } }),
      refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: permission, error: null }),
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: inHousehold ? { user_id: "u2" } : null, error: null }),
          }),
        }),
      })),
      auth,
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    return { admin, auth };
  }

  it("saves a member's name on their account, where every screen reads it", async () => {
    const { admin, auth } = asAdmin();
    expect(await renameMember({}, form({ userId: "u2", name: " Blair " }))).toEqual({ saved: true });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith("u2", { user_metadata: { name: "Blair" } });
    // Someone else's name: the admin's own sign-in needn't change.
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refreshes the admin's own sign-in when they rename themselves", async () => {
    const { auth } = asAdmin({ self: "u2" });
    await renameMember({}, form({ userId: "u2", name: "Blair" }));
    expect(auth.refreshSession).toHaveBeenCalledOnce();
  });

  it("renames no one outside the household, and nothing blank", async () => {
    const { admin } = asAdmin({ inHousehold: false });
    expect(await renameMember({}, form({ userId: "stranger", name: "X" }))).toEqual({
      error: "That person isn't in this household.",
    });
    expect((await renameMember({}, form({ userId: "u2", name: "  " }))).error).toMatch(/Type a name/);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("is only for someone who can manage members", async () => {
    asAdmin({ permission: false });
    await expect(renameMember({}, form({ userId: "u2", name: "Blair" }))).rejects.toThrow("REDIRECT:/");
  });
});

describe("sendTestNow", () => {
  function givenHost(host: string | null) {
    vi.mocked(headers).mockResolvedValue(
      new Headers(host ? { host } : {}) as unknown as Awaited<ReturnType<typeof headers>>,
    );
  }

  beforeEach(() => {
    vi.mocked(sendTestNotification).mockResolvedValue({
      trigger: "manual",
      people: 1,
      devices: 2,
      delivered: 2,
      failed: 0,
      removed: 0,
      outcomes: [],
    });
  });

  it("sends the same test the hourly schedule sends, and says how it went", async () => {
    given();
    givenHost("homebase.example");
    expect(await sendTestNow({}, new FormData())).toEqual({
      sent: { people: 1, devices: 2, delivered: 2 },
    });
    expect(sendTestNotification).toHaveBeenCalledWith({
      subject: "https://homebase.example",
      trigger: "manual",
    });
  });

  it("sends a member away without sending anything", async () => {
    given({ permission: false });
    givenHost("homebase.example");
    await expect(sendTestNow({}, new FormData())).rejects.toThrow("REDIRECT:/");
    expect(sendTestNotification).not.toHaveBeenCalled();
  });

  it("names this app as the contact, wherever it is running", async () => {
    given();
    givenHost("localhost:3000");
    await sendTestNow({}, new FormData());
    expect(sendTestNotification).toHaveBeenCalledWith({
      subject: "https://localhost:3000",
      trigger: "manual",
    });
  });

  it("explains a failure without showing its innards", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    given();
    givenHost("homebase.example");
    vi.mocked(sendTestNotification).mockRejectedValue(
      new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY"),
    );
    expect(await sendTestNow({}, new FormData())).toEqual({
      error: "Couldn't send the test notification. Try again.",
    });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

// REQ-159: a test for one person.
describe("sendTestToMember", () => {
  beforeEach(() => {
    vi.mocked(headers).mockResolvedValue(new Headers({ host: "homebase.example" }) as unknown as Awaited<ReturnType<typeof headers>>);
    vi.mocked(sendPush).mockReset();
    vi.mocked(sendPush).mockResolvedValue({
      trigger: "manual",
      people: 1,
      devices: 2,
      delivered: 2,
      failed: 0,
      removed: 0,
      outcomes: [],
    });
  });

  it("sends to that member only, as a manual test, and says how it went", async () => {
    given();
    expect(await sendTestToMember({}, form({ userId: "u-2" }))).toEqual({
      sent: { people: 1, devices: 2, delivered: 2 },
    });
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "manual", to: ["u-2"], subject: "https://homebase.example" }),
    );
  });

  it("reports nobody switched on rather than sending", async () => {
    given();
    vi.mocked(sendPush).mockResolvedValue({
      trigger: "manual", people: 0, devices: 0, delivered: 0, failed: 0, removed: 0, outcomes: [],
    });
    expect(await sendTestToMember({}, form({ userId: "u-2" }))).toEqual({
      sent: { people: 0, devices: 0, delivered: 0 },
    });
  });

  it("sends a member away without sending anything", async () => {
    given({ permission: false });
    await expect(sendTestToMember({}, form({ userId: "u-2" }))).rejects.toThrow("REDIRECT:/");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("asks which member when none is named", async () => {
    given();
    expect(await sendTestToMember({}, form({}))).toEqual({ error: "Which member?" });
  });
});

// REQ-160: the admin removing any member's device.
describe("removeMemberDevice", () => {
  beforeEach(() => {
    vi.mocked(removeDevice).mockReset();
  });

  it("removes the device and refreshes the console", async () => {
    given();
    vi.mocked(removeDevice).mockResolvedValue("https://web.push.apple.com/x");
    expect(await removeMemberDevice("d-1")).toEqual({ done: "Removed." });
    expect(removeDevice).toHaveBeenCalledWith(expect.anything(), "d-1");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("says so when the device is already gone", async () => {
    given();
    vi.mocked(removeDevice).mockResolvedValue(null);
    expect(await removeMemberDevice("d-1")).toEqual({ error: "That device is already gone." });
  });

  it("sends a member away without removing anything", async () => {
    given({ permission: false });
    await expect(removeMemberDevice("d-1")).rejects.toThrow("REDIRECT:/");
    expect(removeDevice).not.toHaveBeenCalled();
  });
});

// REQ-158: the admin changing a member's email.
describe("changeMemberEmail", () => {
  const MEMBERS = [
    { user_id: "u-admin", email: "vin@example.com" },
    { user_id: "u-2", email: "membera@example.com" },
  ] as Awaited<ReturnType<typeof listMembers>>;

  function setup({
    lastSignIn = "2026-10-01T00:00:00Z" as string | null,
    adminUpdateError = null as { code?: string; message: string } | null,
    updateUserError = null as { code?: string; message: string } | null,
    resetError = null as { code?: string; message: string } | null,
    me = "u-admin",
  } = {}) {
    const base = given({ adminUpdateError });
    vi.mocked(headers).mockResolvedValue(new Headers({ host: "homebase.example" }) as unknown as Awaited<ReturnType<typeof headers>>);
    vi.mocked(listMembers).mockResolvedValue(MEMBERS);
    const own = { updateUser: vi.fn().mockResolvedValue({ error: updateUserError }), getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: me } } }) };
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      auth: own,
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    base.admin.auth.admin.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: lastSignIn } }, error: null });
    base.admin.auth.admin.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hash-1" } }, error: null });
    const asThem = {
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: updateUserError }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: resetError }),
    };
    vi.mocked(createEphemeralClient).mockReturnValue({ auth: asThem } as unknown as ReturnType<typeof createEphemeralClient>);
    return { admin: base.admin, own, asThem };
  }

  it("for someone who has signed in, has Supabase send a confirmation to the new address only, as them", async () => {
    const { admin, asThem } = setup();
    expect(await changeMemberEmail({}, form({ userId: "u-2", email: " New@Example.com" }))).toEqual({
      sent: { address: "new@example.com", kind: "confirm" },
    });
    expect(admin.auth.admin.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "membera@example.com" });
    expect(asThem.verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "hash-1" });
    expect(asThem.updateUser).toHaveBeenCalledWith(
      { email: "new@example.com" },
      { emailRedirectTo: "https://homebase.example/auth/confirm" },
    );
    // The change is theirs to confirm: nothing is changed directly, and that sign-in is ended.
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(asThem.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("changing your own uses your own session, with no borrowed sign-in", async () => {
    const { own, asThem, admin } = setup();
    await changeMemberEmail({}, form({ userId: "u-admin", email: "vin2@example.com" }));
    expect(own.updateUser).toHaveBeenCalledWith({ email: "vin2@example.com" }, { emailRedirectTo: "https://homebase.example/auth/confirm" });
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(asThem.verifyOtp).not.toHaveBeenCalled();
  });

  it("for someone who never signed in, moves the address, voids the old password, and sends a link to choose one", async () => {
    const { admin, asThem } = setup({ lastSignIn: null });
    expect(await changeMemberEmail({}, form({ userId: "u-2", email: "megan@example.com" }))).toEqual({
      sent: { address: "megan@example.com", kind: "invite" },
    });
    const [id, attributes] = admin.auth.admin.updateUserById.mock.calls[0];
    expect(id).toBe("u-2");
    expect(attributes).toMatchObject({ email: "megan@example.com", email_confirm: true, app_metadata: { must_set_password: true } });
    expect(attributes.password).toHaveLength(32);
    expect(asThem.resetPasswordForEmail).toHaveBeenCalledWith("megan@example.com", {
      redirectTo: "https://homebase.example/auth/confirm",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("says plainly when the address changed but the email didn't send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ lastSignIn: null, resetError: { code: "over_email_send_rate_limit", message: "x" } });
    const state = await changeMemberEmail({}, form({ userId: "u-2", email: "megan@example.com" }));
    expect(state.error).toMatch(/address is changed, but the email didn't send/);
    expect(state.sent).toBeUndefined();
  });

  it("refuses an address another member uses, the member's own, or a bad one, changing nothing", async () => {
    const { admin, asThem } = setup();
    expect((await changeMemberEmail({}, form({ userId: "u-2", email: "VIN@example.com" }))).error).toMatch(/already belongs to another account/);
    expect((await changeMemberEmail({}, form({ userId: "u-2", email: "membera@example.com" }))).error).toBe("That is already their email.");
    expect((await changeMemberEmail({}, form({ userId: "u-2", email: "nope" }))).error).toMatch(/full email address/);
    expect((await changeMemberEmail({}, form({ userId: "stranger", email: "x@example.com" }))).error).toBe("That person isn't in this household.");
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(asThem.updateUser).not.toHaveBeenCalled();
  });

  it("refuses Supabase's own duplicate answer with the same clear message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ lastSignIn: null, adminUpdateError: { code: "email_exists", message: "x" } });
    expect((await changeMemberEmail({}, form({ userId: "u-2", email: "x@example.com" }))).error).toMatch(/already belongs to another account/);
  });

  it("sends a non-admin away without touching anything", async () => {
    const { admin } = setup();
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
      auth: {},
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    await expect(changeMemberEmail({}, form({ userId: "u-2", email: "x@example.com" }))).rejects.toThrow("REDIRECT:/");
    expect(admin.auth.admin.getUserById).not.toHaveBeenCalled();
  });
});
