// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshApp } from "../lib/app-refresh";
import { CHECK_MS, NewVersionToast } from "./new-version-toast";

vi.mock("../lib/app-refresh", async (original) => ({
  ...(await original<typeof import("../lib/app-refresh")>()),
  refreshApp: vi.fn(),
}));

// What /api/version answers, one reply per check.
function serverRuns(...builds: (string | "sign-in page")[]) {
  const fetch = vi.fn();
  for (const build of builds) {
    fetch.mockResolvedValueOnce(
      build === "sign-in page" ? new Response("<!doctype html>") : Response.json({ build }),
    );
  }
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(refreshApp).mockClear();
});

describe("telling an out-of-date app to refresh (REQ-128)", () => {
  it("shows a note with Refresh when the server runs a newer build, and no way to close it", async () => {
    serverRuns("new-build");
    render(<NewVersionToast loaded="old-build" />);
    await settle();
    const toast = screen.getByRole("status");
    expect(toast.textContent).toBe("New version readyRefresh");
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Refresh"]);
  });

  it("refreshes the way pulling down does when Refresh is pressed", async () => {
    serverRuns("new-build");
    render(<NewVersionToast loaded="old-build" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshApp).toHaveBeenCalledOnce();
    expect(screen.getByRole("button").textContent).toBe("Refreshing…");
  });

  it("shows nothing on the newest build, or when the answer can't be read", async () => {
    serverRuns("same-build");
    render(<NewVersionToast loaded="same-build" />);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    serverRuns("sign-in page");
    render(<NewVersionToast loaded="same-build" />);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("checks again every few minutes, and when the app comes back to the front", async () => {
    vi.useFakeTimers();
    const fetch = serverRuns("same-build", "same-build", "new-build");
    render(<NewVersionToast loaded="same-build" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
