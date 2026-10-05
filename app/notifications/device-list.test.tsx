// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceView } from "../../lib/notifications/devices";
import { stopReceivingHere } from "../../lib/notifications/this-device";
import { DeviceList } from "./device-list";

vi.mock("../../lib/notifications/this-device", () => ({ stopReceivingHere: vi.fn(async () => {}) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const phone: DeviceView = { id: "d1", name: "iPhone, Safari", addedAt: "2026-10-01T10:00:00Z", lastReceivedAt: "2026-10-04T08:00:00Z", thisDevice: true };
const mac: DeviceView = { id: "d2", name: "Mac, Chrome", addedAt: "2026-10-02T10:00:00Z", lastReceivedAt: null, thisDevice: false };

describe("DeviceList", () => {
  it("shows each device's name, when added and when it last received a notification, and marks this one", async () => {
    render(<DeviceList load={async () => [phone, mac]} remove={vi.fn()} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0].textContent).toContain("iPhone, Safari");
    expect(rows[0].textContent).toContain("This device");
    expect(rows[0].textContent).toContain("Added");
    expect(rows[0].textContent).toContain("Last notification");
    expect(rows[1].textContent).toContain("No notification yet");
    expect(rows[1].textContent).not.toContain("This device");
  });

  it("removes a device you aren't holding, and drops it from the list", async () => {
    const remove = vi.fn(async () => ({ done: "Removed." }));
    render(<DeviceList load={async () => [phone, mac]} remove={remove} />);
    const row = (await screen.findByText("Mac, Chrome")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("Mac, Chrome")).toBeNull());
    expect(remove).toHaveBeenCalledWith("d2");
    expect(stopReceivingHere).not.toHaveBeenCalled();
  });

  it("also tells this phone's push service to forget it, when it's this device", async () => {
    render(<DeviceList load={async () => [phone]} remove={async () => ({ done: "Removed." })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(stopReceivingHere).toHaveBeenCalled());
  });

  it("keeps a device in the list and says why when removing fails", async () => {
    render(<DeviceList load={async () => [mac]} remove={async () => ({ error: "Couldn't remove that device. Try again." })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Couldn't remove that device. Try again.");
    expect(screen.getByText("Mac, Chrome")).toBeTruthy();
  });

  it("offers a test per device only where a test is given, and shows its result", async () => {
    const test = vi.fn(async () => ({ done: "Sent." }));
    render(<DeviceList load={async () => [phone, mac]} remove={vi.fn()} test={test} />);
    const buttons = await screen.findAllByRole("button", { name: "Send test" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(await screen.findByText("Sent.")).toBeTruthy();
    expect(test).toHaveBeenCalledWith("d2");
  });

  it("has no Send test when none is given (the admin's list)", async () => {
    render(<DeviceList initial={[mac]} remove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Send test" })).toBeNull();
  });

  it("says so when there are none", async () => {
    render(<DeviceList load={async () => []} remove={vi.fn()} />);
    expect(await screen.findByText("No devices yet.")).toBeTruthy();
  });
});
