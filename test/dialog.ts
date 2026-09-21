// jsdom, the stand-in browser the component tests run in, has no working
// <dialog> yet: showModal() and close() don't exist. This adds the part
// our sheets rely on, the way a real browser behaves: showModal() sets
// `open`, close() clears it and fires a "close" event. The rest is the
// browser's own. In a real browser, focus moved into an opened sheet and
// back to the button that opened it on closing. Escape wasn't checked:
// the automated key presses used here carry no key code, so the browser
// ignores them as a way to close a dialog.
export function installDialogStandIn() {
  const proto = window.HTMLDialogElement.prototype;
  if (typeof proto.showModal === "function") return;
  Object.defineProperty(proto, "open", {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute("open");
    },
  });
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
