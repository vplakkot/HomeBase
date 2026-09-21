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
  // REQ-22: the worker reports deliveries and taps back to the app.
  const fetch = vi.fn(async () => ({ status: 204 }));
  const skipWaiting = vi.fn();
  const claim = vi.fn(async () => {});
  const self = {
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    skipWaiting,
    location: { origin: "https://homebase.example" },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => openWindows), openWindow, claim },
  };
  runInNewContext(source, { self, URL, fetch });

  async function dispatch(type: string, event: object) {
    const pending: Promise<unknown>[] = [];
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }
  return { dispatch, showNotification, openWindow, fetch, skipWaiting, claim };
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
      data: { url: "/", receipt: "" },
    });
  });

  it("still shows a notification when a push has no readable message", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", { data: null });
    await worker.dispatch("push", pushWith("plain words"));
    expect(worker.showNotification).toHaveBeenNthCalledWith(1, "HomeBase", {
      body: "",
      data: { url: "/", receipt: "" },
    });
    expect(worker.showNotification).toHaveBeenNthCalledWith(2, "HomeBase", {
      body: "plain words",
      data: { url: "/", receipt: "" },
    });
  });

  it("still shows a notification when the message is literally null", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", pushWith(null));
    expect(worker.showNotification).toHaveBeenCalledWith("HomeBase", {
      body: "",
      data: { url: "/", receipt: "" },
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

  // A new worker normally installs and then waits until every window
  // using the old one has closed. An installed app can sit in the app
  // switcher for days, so without this a fix never reaches the phone —
  // which cost the first night of the v0.1 test week.
  it("takes over as soon as it installs, instead of waiting", async () => {
    const worker = loadWorker();
    await worker.dispatch("install", {});
    expect(worker.skipWaiting).toHaveBeenCalled();
  });

  it("claims windows that are already open", async () => {
    const worker = loadWorker();
    await worker.dispatch("activate", {});
    expect(worker.claim).toHaveBeenCalled();
  });

  // REQ-22. Nothing else can report the delivery: the worker runs with no
  // page and no session, and the phone's owner may be signed out. The
  // token that came inside this one message is the whole proof.
  it("tells the app a notification arrived, using the token it was sent", async () => {
    const worker = loadWorker();
    await worker.dispatch(
      "push",
      pushWith({ title: "Test", body: "Hourly check", receipt: "token-abc" }),
    );
    expect(worker.fetch).toHaveBeenCalledWith("/api/notifications/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt: "token-abc", event: "delivered" }),
    });
  });

  it("reports the tap when a notification is opened", async () => {
    const worker = loadWorker();
    await worker.dispatch("notificationclick", {
      notification: {
        close: vi.fn(),
        data: { url: "/", receipt: "token-abc" },
      },
    });
    expect(worker.fetch).toHaveBeenCalledWith("/api/notifications/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt: "token-abc", event: "tapped" }),
    });
  });

  // A message from before this existed, or one that lost its token, still
  // has to show. The report is the optional part.
  it("still shows a push that carries no token, and reports nothing", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", pushWith({ title: "Test", body: "No token" }));
    expect(worker.showNotification).toHaveBeenCalled();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  // Showing the notification is the job. A failed report must never take
  // the notification down with it.
  it("still shows the notification when the report can't be sent", async () => {
    const worker = loadWorker();
    worker.fetch.mockRejectedValue(new Error("offline"));
    await expect(
      worker.dispatch(
        "push",
        pushWith({ title: "Test", body: "Hourly check", receipt: "token-abc" }),
      ),
    ).resolves.not.toThrow();
    expect(worker.showNotification).toHaveBeenCalled();
  });

  it("still opens the app when the tap report can't be sent", async () => {
    const worker = loadWorker();
    worker.fetch.mockRejectedValue(new Error("offline"));
    await worker.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { url: "/", receipt: "t" } },
    });
    expect(worker.openWindow).toHaveBeenCalledWith("/");
  });
});
