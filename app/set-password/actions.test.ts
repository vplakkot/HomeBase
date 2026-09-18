import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";
import { setPassword } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function given({
  signedIn = true,
  updateError = null,
  flagError = null,
}: {
  signedIn?: boolean;
  updateError?: { message: string } | null;
  flagError?: { message: string } | null;
} = {}) {
  const user = {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: signedIn ? { claims: { sub: "user-2" } } : null,
        error: null,
      }),
      updateUser: vi.fn().mockResolvedValue({ data: {}, error: updateError }),
      refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  };
  const admin = {
    auth: {
      admin: {
        updateUserById: vi.fn().mockResolvedValue({ data: {}, error: flagError }),
      },
    },
  };
  vi.mocked(createClient).mockResolvedValue(
    user as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>,
  );
  return { user, admin };
}

function form(password: string, confirmation = password) {
  const data = new FormData();
  data.set("password", password);
  data.set("confirmation", confirmation);
  return data;
}

describe("setPassword", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(createAdminClient).mockReset();
  });

  it("insists on at least 8 characters", async () => {
    const { user } = given();
    const state = await setPassword({}, form("short"));
    expect(state.error).toBe("Use at least 8 characters.");
    expect(user.auth.updateUser).not.toHaveBeenCalled();
  });

  it("insists the two entries match", async () => {
    const { user } = given();
    const state = await setPassword({}, form("longenough1", "longenough2"));
    expect(state.error).toBe("The two passwords don't match.");
    expect(user.auth.updateUser).not.toHaveBeenCalled();
  });

  it("changes the password, clears the reminder, refreshes the session, goes home", async () => {
    const { user, admin } = given();
    await expect(setPassword({}, form("a-new-password"))).rejects.toThrow("REDIRECT:/");
    expect(user.auth.updateUser).toHaveBeenCalledWith({ password: "a-new-password" });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith("user-2", {
      app_metadata: { must_set_password: false },
    });
    expect(user.auth.refreshSession).toHaveBeenCalled();
  });

  it("shows Supabase's reason when the password is refused", async () => {
    given({ updateError: { message: "New password should be different from the old password." } });
    const state = await setPassword({}, form("Temp-Password-1!"));
    expect(state.error).toBe("New password should be different from the old password.");
  });

  it("never clears the reminder if the password change failed", async () => {
    const { admin } = given({ updateError: { message: "nope" } });
    await setPassword({}, form("a-new-password"));
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});
