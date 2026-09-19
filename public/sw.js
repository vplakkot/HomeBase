// HomeBase's service worker: the small part of the app the phone keeps
// running in the background, so a notification can arrive while the app
// is closed. A device can only sign up for notifications once one is
// registered. It has to live at the site's root to cover every page.

// iPhones require every push to show a notification; a silent one counts
// against the app. So even a push with no readable message shows one.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || "HomeBase", {
      body: message.body || "",
      data: { url: message.url || "/" },
    }),
  );
});

// Tapping a notification opens the app, or brings it forward if it's
// already open.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((window) => "focus" in window);
        return open ? open.focus() : self.clients.openWindow(url);
      }),
  );
});
