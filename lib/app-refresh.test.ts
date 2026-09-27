import { afterEach, describe, expect, it, vi } from "vitest";
import { isOutOfDate, refreshApp } from "./app-refresh";

// A stand-in for the phone's service worker registration: update() finds
// a new worker, which takes over a moment later (public/sw.js skips
// waiting), or finds nothing new.
function registration(found: boolean) {
  const worker = new EventTarget() as EventTarget & { state: string };
  worker.state = "installing";
  const reg = {
    installing: null as typeof worker | null,
    waiting: null,
    update: vi.fn(async () => {
      if (!found) return;
      reg.installing = worker;
      setTimeout(() => {
        worker.state = "activated";
        worker.dispatchEvent(new Event("statechange"));
      }, 10);
    }),
  };
  return { reg, worker };
}

function givenWorker(reg: unknown) {
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn(async () => reg) } });
}

afterEach(() => vi.unstubAllGlobals());

describe("refreshing the installed app (REQ-127)", () => {
  it("fetches a newer service worker and lets it take over before reloading", async () => {
    const { reg, worker } = registration(true);
    givenWorker(reg);
    const reload = vi.fn(() => expect(worker.state).toBe("activated"));
    await refreshApp(reload);
    expect(reg.update).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("with no newer build, just reloads", async () => {
    const { reg } = registration(false);
    givenWorker(reg);
    const reload = vi.fn();
    await refreshApp(reload);
    expect(reg.update).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads even with no service worker, or when checking for one fails", async () => {
    givenWorker(undefined);
    const reload = vi.fn();
    await refreshApp(reload);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn(async () => Promise.reject(new Error("offline"))) } });
    await refreshApp(reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe("telling an old build from the newest (REQ-128)", () => {
  it("is out of date only when the server names a different build", () => {
    expect(isOutOfDate("abc", "def")).toBe(true);
    expect(isOutOfDate("abc", "abc")).toBe(false);
    expect(isOutOfDate("abc", undefined)).toBe(false);
    expect(isOutOfDate("abc", "")).toBe(false);
  });
});
