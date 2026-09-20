// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopReceivingHere, subscriptionOnThisDevice } from "./this-device";

// jsdom has no service workers, so each test describes the browser it is
// pretending to be. This is the only place the push service is actually
// told to forget a device, and sign-out can't be exercised in a desktop
// browser, so it is worth pinning here.
function givenBrowser({
  hasServiceWorker = true,
  registered = true,
  subscribed = true,
  unsubscribeFails = false,
} = {}) {
  const unsubscribe = unsubscribeFails
    ? vi.fn(async () => {
        throw new Error("push service unreachable");
      })
    : vi.fn(async () => true);
  const subscription = { unsubscribe };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => (subscribed ? subscription : null)),
    },
  };
  if (hasServiceWorker) {
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn(async () => (registered ? registration : undefined)),
      },
      configurable: true,
    });
  }
  return { unsubscribe, registration };
}

afterEach(() => {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe("subscriptionOnThisDevice", () => {
  it("finds the subscription this browser is signed up with", async () => {
    givenBrowser();
    expect(await subscriptionOnThisDevice()).not.toBeNull();
  });

  it("is nothing when the browser has no service worker at all", async () => {
    givenBrowser({ hasServiceWorker: false });
    expect(await subscriptionOnThisDevice()).toBeNull();
  });

  it("is nothing when no service worker is registered yet", async () => {
    givenBrowser({ registered: false });
    expect(await subscriptionOnThisDevice()).toBeNull();
  });

  it("is nothing when this device never signed up", async () => {
    givenBrowser({ subscribed: false });
    expect(await subscriptionOnThisDevice()).toBeNull();
  });
});

describe("stopReceivingHere", () => {
  it("asks the push service to forget this device", async () => {
    const { unsubscribe } = givenBrowser();
    await stopReceivingHere();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does nothing, quietly, when this device never signed up", async () => {
    const { unsubscribe } = givenBrowser({ subscribed: false });
    await expect(stopReceivingHere()).resolves.toBeUndefined();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  // Signing out must never wait on, or fail because of, the push service.
  it("never throws when the push service can't be reached", async () => {
    givenBrowser({ unsubscribeFails: true });
    await expect(stopReceivingHere()).resolves.toBeUndefined();
  });

  it("never throws when the browser has no service worker", async () => {
    givenBrowser({ hasServiceWorker: false });
    await expect(stopReceivingHere()).resolves.toBeUndefined();
  });
});
