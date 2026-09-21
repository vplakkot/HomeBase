// HomeBase's service worker: the small part of the app the phone keeps
// running in the background, so a notification can arrive while the app
// is closed. A device can only sign up for notifications once one is
// registered. It has to live at the site's root to cover every page.

// Take over as soon as we arrive.
//
// By default a new service worker installs and then *waits*: it will not
// control anything until every window using the old one has closed. On a
// phone an installed app can sit in the app switcher for days, so the old
// worker keeps control and a fix never reaches the device. That is not a
// cache being stale — the new file is downloaded and then deliberately
// held back.
//
// This cost us the first night of the v0.1 test week: 19 notifications
// arrived on a phone whose worker predated the code that reports them,
// and every one was recorded as never delivered.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  // skipWaiting alone activates the new worker; claim() also hands it the
  // windows that are already open, instead of waiting for the next launch.
  event.waitUntil(self.clients.claim());
});

// Only a path inside HomeBase, such as "/" or "/finances". Anything else
// becomes the home page, so a notification can never open another
// website. This asks the browser's own address parser rather than
// matching the text: a link can hide a tab or a line break, which the
// parser strips, so "/<tab>/other.site" really means "//other.site".
function pathInsideHomeBase(url) {
  if (typeof url !== "string") {
    return "/";
  }
  try {
    const address = new URL(url, self.location.origin);
    if (address.origin === self.location.origin) {
      return address.pathname + address.search + address.hash;
    }
  } catch {
    // Not an address at all; fall through to the home page.
  }
  return "/";
}

// REQ-22. Tell the app a notification arrived, or was tapped. The token
// came inside this one message, to this one device, so it is the proof
// that the report is real — there is no session out here, and there may
// be nobody signed in on the phone at all.
//
// Never let this fail loudly: a notification that showed is a success
// even if the report of it got lost.
function reportReceipt(receipt, event) {
  if (typeof receipt !== "string" || !receipt) {
    return Promise.resolve();
  }
  return fetch("/api/notifications/receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ receipt: receipt, event: event }),
  }).catch(() => {});
}

// iPhones require every push to show a notification; a silent one counts
// against the app. So even a push with no readable message shows one.
self.addEventListener("push", (event) => {
  let message;
  try {
    message = event.data ? event.data.json() : null;
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  if (!message || typeof message !== "object") {
    message = {};
  }
  const receipt = typeof message.receipt === "string" ? message.receipt : "";
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(message.title || "HomeBase", {
        body: message.body ? String(message.body) : "",
        // The token rides along, so tapping can be reported too.
        data: { url: pathInsideHomeBase(message.url), receipt: receipt },
      }),
      reportReceipt(receipt, "delivered"),
    ]),
  );
});

// Tapping a notification opens the app, or brings it forward if it's
// already open.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = pathInsideHomeBase(
    event.notification.data && event.notification.data.url,
  );
  const receipt =
    event.notification.data && event.notification.data.receipt;
  event.waitUntil(
    Promise.all([
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((windows) => {
          const open = windows.find((window) => "focus" in window);
          return open ? open.focus() : self.clients.openWindow(url);
        }),
      reportReceipt(receipt, "tapped"),
    ]),
  );
});
