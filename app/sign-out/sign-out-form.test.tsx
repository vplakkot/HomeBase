import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopReceivingHere } from "../../lib/notifications/this-device";
import { signOut } from "./actions";
import { SignOutForm } from "./sign-out-form";

vi.mock("../../lib/notifications/this-device", () => ({
  stopReceivingHere: vi.fn(async () => {}),
}));
vi.mock("./actions", () => ({ signOut: vi.fn(async () => {}) }));

describe("SignOutForm", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // The push service has to forget this device before the session ends,
  // and signing out must still happen either way.
  it("tells the push service to forget this device, then signs out", async () => {
    render(<SignOutForm />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(stopReceivingHere).toHaveBeenCalledTimes(1);
    expect(vi.mocked(stopReceivingHere).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(signOut).mock.invocationCallOrder[0],
    );
  });

  it("signs out even when the push service can't be reached", async () => {
    vi.mocked(stopReceivingHere).mockRejectedValueOnce(new Error("offline"));
    render(<SignOutForm />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
