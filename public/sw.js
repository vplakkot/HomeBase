// HomeBase's service worker: the small part of the app the phone keeps
// running in the background, so a notification can arrive while the app
// is closed. A device can only sign up for notifications once one is
// registered. It has to live at the site's root to cover every page.

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
