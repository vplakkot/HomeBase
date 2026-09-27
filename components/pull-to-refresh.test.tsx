// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshApp } from "../lib/app-refresh";
import { PULL_TO_REFRESH, PullToRefresh } from "./pull-to-refresh";

vi.mock("../lib/app-refresh", () => ({ refreshApp: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/drinks" }));

function installed(yes: boolean) {
  window.matchMedia = vi.fn(() => ({ matches: yes }) as MediaQueryList);
}

// A finger going down at the top of the screen, moving `by` pixels, and
// letting go. The spinner follows at half the finger's travel.
function pull(by: number, on: Element = document.body) {
  fireEvent.touchStart(on, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(on, { touches: [{ clientY: 100 + by }] });
  fireEvent.touchEnd(on);
}
const FAR = PULL_TO_REFRESH * 2 + 10;

beforeEach(() => {
  installed(true);
  window.scrollY = 0;
});
afterEach(() => {
  cleanup();
  vi.mocked(refreshApp).mockClear();
  document.body.innerHTML = "";
});

describe("pull down to refresh (REQ-127)", () => {
  it("refreshes when pulled far enough from the top and let go, with a spinner until the reload", () => {
    render(<PullToRefresh />);
    act(() => pull(FAR));
    expect(refreshApp).toHaveBeenCalledOnce();
    expect(screen.getByRole("status", { name: "Refreshing" })).toBeTruthy();
  });

  it("shows the spinner coming down while pulling, and does nothing on a short pull", () => {
    render(<PullToRefresh />);
    act(() => {
      fireEvent.touchStart(document.body, { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(document.body, { touches: [{ clientY: 140 }] });
    });
    expect(screen.getByRole("status", { name: "Pull to refresh" })).toBeTruthy();
    act(() => fireEvent.touchEnd(document.body));
    expect(refreshApp).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is ordinary scrolling when the page is scrolled down, or a box inside it is", () => {
    render(<PullToRefresh />);
    window.scrollY = 200;
    act(() => pull(FAR));
    window.scrollY = 0;
    const box = document.createElement("div");
    const inside = document.createElement("p");
    box.append(inside);
    document.body.append(box);
    box.scrollTop = 50;
    act(() => pull(FAR, inside));
    expect(refreshApp).not.toHaveBeenCalled();
  });

  it("never refreshes with a sheet or dialog open, or unsaved work on screen", () => {
    render(<PullToRefresh />);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    act(() => pull(FAR));
    dialog.remove();
    const scan = document.createElement("div");
    scan.setAttribute("data-unsaved", "");
    document.body.append(scan);
    act(() => pull(FAR));
    expect(refreshApp).not.toHaveBeenCalled();
  });

  it("never refreshes once something has been typed into a form on this screen", () => {
    render(<PullToRefresh />);
    const field = document.createElement("input");
    document.body.append(field);
    fireEvent.input(field, { target: { value: "Rioja" } });
    act(() => pull(FAR));
    expect(refreshApp).not.toHaveBeenCalled();
  });

  it("does nothing outside the installed app: the browser has its own reload", () => {
    installed(false);
    render(<PullToRefresh />);
    act(() => pull(FAR));
    expect(refreshApp).not.toHaveBeenCalled();
  });
});
