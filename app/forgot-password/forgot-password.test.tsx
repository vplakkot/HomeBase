// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEphemeralClient } from "../../lib/supabase/ephemeral";
import { requestPasswordReset } from "./actions";
import ForgotPasswordPage from "./page";

vi.mock("../../lib/supabase/ephemeral", () => ({ createEphemeralClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "homebase.example" })) }));

function given(error: { code?: string; message: string } | null = null) {
  const resetPasswordForEmail = vi.fn().mockResolvedValue({ error });
  vi.mocked(createEphemeralClient).mockReturnValue({ auth: { resetPasswordForEmail } } as unknown as ReturnType<typeof createEphemeralClient>);
  return resetPasswordForEmail;
}
const typed = (email: string) => {
  const data = new FormData();
  data.set("email", email);
  return data;
};

describe("requestPasswordReset (#80)", () => {
  it("asks Supabase for a recovery link that lands on this app's own confirm page", async () => {
    const send = given();
    expect(await requestPasswordReset({}, typed(" Vin@Example.com "))).toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith("vin@example.com", { redirectTo: "https://homebase.example/auth/confirm" });
  });

  it("says the same thing for any address, so it can't be used to find who has an account", async () => {
    given();
    expect(await requestPasswordReset({}, typed("nobody@example.com"))).toEqual({ sent: true });
  });

  it("refuses what isn't an address, sending nothing", async () => {
    const send = given();
    expect((await requestPasswordReset({}, typed("nope"))).error).toMatch(/full email address/);
    expect(send).not.toHaveBeenCalled();
  });

  it("says so when too many emails were sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    given({ code: "over_email_send_rate_limit", message: "x" });
    expect((await requestPasswordReset({}, typed("vin@example.com"))).error).toMatch(/Too many emails/);
  });
});

describe("the forgot-password page", () => {
  afterEach(cleanup);

  it("asks for an email, links back to sign-in, and confirms without revealing whether it matched", async () => {
    given();
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("heading", { name: "Forgot your password?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/sign-in");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "vin@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the link" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/If that address has an account/));
  });
});
