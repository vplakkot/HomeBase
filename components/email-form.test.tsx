// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailForm } from "./email-form";

afterEach(cleanup);

describe("EmailForm", () => {
  it("says a confirmation was sent, and that nothing changes until it's confirmed", async () => {
    const action = vi.fn(async () => ({ sent: { address: "new@example.com", kind: "confirm" as const } }));
    render(<EmailForm action={action} label="New email" />);
    fireEvent.change(screen.getByLabelText("New email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("A confirmation was sent to new@example.com"));
    expect(screen.getByRole("status").textContent).toContain("once it's confirmed");
  });

  it("says a first-time link was sent for someone who never signed in", async () => {
    render(<EmailForm action={async () => ({ sent: { address: "m@example.com", kind: "invite" as const } })} label="New email" userId="u2" />);
    fireEvent.change(screen.getByLabelText("New email"), { target: { value: "m@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("link to choose a password was sent to m@example.com"));
  });

  it("shows a refusal", async () => {
    render(<EmailForm action={async () => ({ error: "That address already belongs to another account in this household." })} label="New email" />);
    fireEvent.change(screen.getByLabelText("New email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already belongs/));
  });

  it("sends the member's id along on the admin console", () => {
    const { container } = render(<EmailForm action={vi.fn()} label="x" userId="u2" />);
    expect((container.querySelector('input[name="userId"]') as HTMLInputElement).value).toBe("u2");
  });
});
