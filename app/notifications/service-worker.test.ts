// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// public/sw.js runs inside the phone, not in Node, so it can't be imported.
// These tests run the file's own text against a stand-in for the phone's
// side of the conversation and check what it asks the phone to do.
const source = readFileSync(
  join(__dirname, "..", "..", "public", "sw.js"),
  "utf-8",
);

type Listener = (event: object) => void;

function loadWorker({ openWindows = [] as object[] } = {}) {
  const listeners: Record<string, Listener> = {};
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => {});
  const self = {
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    location: { origin: "https://homebase.example" },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => openWindows), openWindow },
  };
  runInNewContext(source, { self, URL });

  async function dispatch(type: string, event: object) {
    const pending: Promise<unknown>[] = [];
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }
  return { dispatch, showNotification, openWindow };
}

function pushWith(message: unknown) {
  return {
    data: {
      json: () => {
        if (typeof message !== "object") throw new SyntaxError("not JSON");
        return message;
      },
      text: () => String(message),
    },
  };
}

describe("the service worker", () => {
  it("shows the title and message a push carries", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", pushWith({ title: "Test", body: "Hourly check" }));
    expect(worker.showNotification).toHaveBeenCalledWith("Test", {
      body: "Hourly check",
      data: { url: "/" },
    });
  });

  it("still shows a notification when a push has no readable message", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", { data: null });
    await worker.dispatch("push", pushWith("plain words"));
    expect(worker.showNotification).toHaveBeenNthCalledWith(1, "HomeBase", {
      body: "",
      data: { url: "/" },
    });
    expect(worker.showNotification).toHaveBeenNthCalledWith(2, "HomeBase", {
      body: "plain words",
      data: { url: "/" },
    });
  });

  it("still shows a notification when the message is literally null", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", pushWith(null));
    expect(worker.showNotification).toHaveBeenCalledWith("HomeBase", {
      body: "",
      data: { url: "/" },
    });
  });

  it("keeps a push's link inside HomeBase", async () => {
    const worker = loadWorker();
    const links: [unknown, string][] = [
      ["/finances", "/finances"],
      ["/finances?month=9#owed", "/finances?month=9#owed"],
      ["https://other.example/x", "/"],
      ["//other.example/x", "/"],
      ["/\\other.example/x", "/"],
      // A tab or line break inside a link is stripped by the browser, so
      // these two really mean "//other.example/x".
      ["/\t/other.example/x", "/"],
      ["/\n/other.example/x", "/"],
      [42, "/"],
    ];
    for (const [url] of links) {
      await worker.dispatch("push", pushWith({ title: "T", url }));
    }
    const opened = worker.showNotification.mock.calls.map(
      (call) => (call as unknown as [string, { data: { url: string } }])[1].data.url,
    );
    expect(opened).toEqual(links.map(([, expected]) => expected));
  });

  it("opens the home page when a tapped notification names another site", async () => {
    const worker = loadWorker();
    for (const url of ["https://other.example/x", "/\t/other.example/x"]) {
      await worker.dispatch("notificationclick", {
        notification: { close: vi.fn(), data: { url } },
      });
    }
    expect(worker.openWindow).toHaveBeenNthCalledWith(1, "/");
    expect(worker.openWindow).toHaveBeenNthCalledWith(2, "/");
  });

  it("opens the app when a notification is tapped", async () => {
    const worker = loadWorker();
    const close = vi.fn();
    await worker.dispatch("notificationclick", {
      notification: { close, data: { url: "/" } },
    });
    expect(close).toHaveBeenCalled();
    expect(worker.openWindow).toHaveBeenCalledWith("/");
  });

  it("brings the app forward instead if it's already open", async () => {
    const focus = vi.fn(async () => {});
    const worker = loadWorker({ openWindows: [{ focus }] });
    await worker.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { url: "/" } },
    });
    expect(focus).toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });
});
