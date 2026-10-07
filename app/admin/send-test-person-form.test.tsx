// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTestToMember } from "./actions";
import { SendTestPersonForm } from "./send-test-person-form";

vi.mock("./actions", () => ({ sendTestToMember: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.mocked(sendTestToMember).mockReset();
});

async function sendWith(sent: { people: number; devices: number; delivered: number }) {
  vi.mocked(sendTestToMember).mockResolvedValue({ sent });
  render(<SendTestPersonForm userId="u1" enabled name="Meg" />);
  fireEvent.click(screen.getByRole("button", { name: "Send test to Meg" }));
  await waitFor(() => expect(sendTestToMember).toHaveBeenCalled());
}

describe("SendTestPersonForm", () => {
  it("shows a check, not a sentence, when every device got the test", async () => {
    await sendWith({ people: 1, devices: 1, delivered: 1 });
    expect(await screen.findByLabelText("Sent")).toBeTruthy();
    expect(screen.queryByText(/Sent to/)).toBeNull();
  });

  it("keeps words for a test that only partly went through", async () => {
    await sendWith({ people: 1, devices: 2, delivered: 1 });
    expect(await screen.findByText("Sent to 1 of 2 devices; the rest didn't go through.")).toBeTruthy();
    expect(screen.queryByLabelText("Sent")).toBeNull();
  });
});
