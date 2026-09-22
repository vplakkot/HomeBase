// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveDevice } from "./actions";
import { EnableNotifications, KeepThisDevice } from "./enable-notifications";

vi.mock("./actions", () => ({ saveDevice: vi.fn() }));

// A made-up public key in the same shape as a real one: 65 bytes, first 4.
const KEY_BYTES = [4, ...Array.from({ length: 64 }, (_, i) => i)];
const PUBLIC_KEY = Buffer.from(KEY_BYTES).toString("base64url");

const DEVICE_JSON = {
  endpoint: "https://web.push.apple.com/QGuQyavXutnMfBCd",
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7KI4CCXg" },
};

// jsdom has no notifications, service workers or home screen, so each test
// describes the phone it's pretending to be.
function givenDevice({
  installed = true,
  supportsPush = true,
  permission = "default" as NotificationPermission,
  answer = "granted" as NotificationPermission,
  alreadySubscribed = false,
  registerFailsOnArrival = false,
} = {}) {
  const makeSubscription = (endpoint: string) => ({
    endpoint,
    toJSON: () => ({ ...DEVICE_JSON, endpoint }),
    unsubscribe: vi.fn(async () => true),
  });
  const subscription = makeSubscription(DEVICE_JSON.endpoint);
  let signUps = 0;
  const pushManager = {
    getSubscription: vi.fn(async () => (alreadySubscribed ? subscription : null)),
    subscribe: vi.fn(async (_options: PushSubscriptionOptionsInit) => {
      signUps += 1;
      return makeSubscription(
        signUps === 1 ? DEVICE_JSON.endpoint : `${DEVICE_JSON.endpoint}-fresh`,
      );
    }),
  };
  const registration = { pushManager };
  // Like a real browser, `ready` waits until a registration succeeds.
  let markReady: (value: typeof registration) => void = () => {};
  const ready = new Promise<typeof registration>((resolve) => {
    markReady = resolve;
  });
  let attempts = 0;
  const serviceWorker = {
    register: vi.fn(async () => {
      attempts += 1;
      if (registerFailsOnArrival && attempts === 1) {
        throw new Error("The operation is insecure.");
      }
      markReady(registration);
      return registration;
    }),
    ready,
  };
  const notification = {
    permission,
    requestPermission: vi.fn(async () => answer),
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: installed && query === "(display-mode: standalone)",
    })),
  );
  if (supportsPush) {
    Object.defineProperty(navigator, "serviceWorker", {
      value: serviceWorker,
      configurable: true,
    });
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", notification);
  }
  return { pushManager, serviceWorker, notification, subscription };
}

async function tapEnable() {
  fireEvent.click(await screen.findByRole("button", { name: "Enable notifications" }));
}

describe("EnableNotifications", () => {
  beforeEach(() => {
    vi.mocked(saveDevice).mockResolvedValue({ saved: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    vi.mocked(saveDevice).mockReset();
  });

  it("in a normal browser tab, explains that notifications need the home-screen install", async () => {
    givenDevice({ installed: false });
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    expect(
      await screen.findByText(/Notifications need HomeBase on your home screen/),
    ).toBeDefined();
    expect(screen.getByText(/tap Share, then Add to Home Screen/)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("in the installed app, gets the device ready and offers the button", async () => {
    const device = givenDevice();
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    expect(
      await screen.findByRole("button", { name: "Enable notifications" }),
    ).toBeDefined();
    expect(device.serviceWorker.register).toHaveBeenCalledWith("/sw.js");
    expect(device.notification.requestPermission).not.toHaveBeenCalled();
  });

  // Checked straight after the click, before anything is awaited: the
  // question has to be asked within the tap itself.
  it("asks the phone's permission within the tap itself", async () => {
    const device = givenDevice();
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    const button = await screen.findByRole("button", { name: "Enable notifications" });
    fireEvent.click(button);
    expect(device.notification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("once allowed, signs this device up and saves it against the account", async () => {
    const device = givenDevice({ answer: "granted" });
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    await tapEnable();
    expect(
      await screen.findByText("Notifications are on for this device."),
    ).toBeDefined();
    const [options] = device.pushManager.subscribe.mock.calls[0];
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual(KEY_BYTES);
    expect(saveDevice).toHaveBeenCalledWith(DEVICE_JSON);
  });

  it("if permission is denied, shows notifications as off and how to turn them on in Settings", async () => {
    const device = givenDevice({ answer: "denied" });
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    await tapEnable();
    expect(
      await screen.findByText(/Notifications are off for this device/),
    ).toBeDefined();
    expect(
      screen.getByText(/open the Settings app, tap Notifications, then HomeBase/),
    ).toBeDefined();
    expect(device.pushManager.subscribe).not.toHaveBeenCalled();
    expect(saveDevice).not.toHaveBeenCalled();
  });

  it("if permission was denied earlier, shows off straight away without asking again", async () => {
    const device = givenDevice({ permission: "denied" });
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    expect(
      await screen.findByText(/Notifications are off for this device/),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
    expect(device.notification.requestPermission).not.toHaveBeenCalled();
  });

  it("if this person already turned this device on, says so without asking again", async () => {
    givenDevice({ permission: "granted", alreadySubscribed: true });
    render(
      <EnableNotifications publicKey={PUBLIC_KEY} knownDevice={DEVICE_JSON.endpoint} />,
    );
    expect(
      await screen.findByText("Notifications are on for this device."),
    ).toBeDefined();
    expect(saveDevice).toHaveBeenCalledWith(DEVICE_JSON);
  });

  // Someone else's device, or this one after they signed out: the browser
  // is still signed up, but nobody may be enrolled without tapping.
  it("never switches notifications on for someone who hasn't tapped", async () => {
    givenDevice({ permission: "granted", alreadySubscribed: true });
    render(<EnableNotifications publicKey={PUBLIC_KEY} knownDevice={null} />);
    expect(
      await screen.findByRole("button", { name: "Enable notifications" }),
    ).toBeDefined();
    expect(saveDevice).not.toHaveBeenCalled();
  });

  it("starts over when this device's address belongs to someone else", async () => {
    const device = givenDevice({ permission: "granted", alreadySubscribed: true });
    vi.mocked(saveDevice)
      .mockResolvedValueOnce({
        saved: false,
        takenByAnother: true,
        error: "This device is already signed up for notifications under someone else in the household.",
      })
      .mockResolvedValueOnce({ saved: true });
    render(<EnableNotifications publicKey={PUBLIC_KEY} knownDevice={null} />);
    await tapEnable();
    expect(
      await screen.findByText("Notifications are on for this device."),
    ).toBeDefined();
    expect(device.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(device.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(saveDevice).toHaveBeenCalledTimes(2);
  });

  it("says so when the device can't receive notifications at all", async () => {
    givenDevice({ supportsPush: false });
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    expect(
      await screen.findByText(/This device can't get notifications from HomeBase/),
    ).toBeDefined();
  });

  it("says so when the server has no push key", async () => {
    givenDevice();
    render(<EnableNotifications publicKey={undefined} />);
    expect(
      await screen.findByText("Notifications aren't set up on this server yet."),
    ).toBeDefined();
  });

  // Without registering again, `ready` would never arrive and the button
  // would sit on "Asking…" for good.
  it("recovers with Try again when getting the device ready failed as the page opened", async () => {
    const device = givenDevice({ registerFailsOnArrival: true });
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The operation is insecure.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Notifications are on for this device."),
    ).toBeDefined();
    expect(device.serviceWorker.register).toHaveBeenCalledTimes(2);
  });

  it("shows why saving failed, and offers to try again", async () => {
    givenDevice();
    vi.mocked(saveDevice).mockResolvedValue({
      saved: false,
      error: "Couldn't save this device: offline",
    });
    render(<EnableNotifications publicKey={PUBLIC_KEY} />);
    await tapEnable();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't save this device: offline",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});

// REQ-85: Home keeps doing the load-time check out of sight.
describe("KeepThisDevice", () => {
  beforeEach(() => {
    vi.mocked(saveDevice).mockResolvedValue({ saved: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    vi.mocked(saveDevice).mockReset();
  });

  it("checks for a newer service worker and re-saves a device this person turned on", async () => {
    const device = givenDevice({ permission: "granted", alreadySubscribed: true });
    const { container } = render(
      <KeepThisDevice publicKey={PUBLIC_KEY} knownDevice={DEVICE_JSON.endpoint} />,
    );
    await waitFor(() => expect(saveDevice).toHaveBeenCalledWith(DEVICE_JSON));
    expect(device.serviceWorker.register).toHaveBeenCalledWith("/sw.js");
    expect(container.innerHTML).toBe("");
  });

  it("never enrols anyone who hasn't tapped", async () => {
    const device = givenDevice({ permission: "granted", alreadySubscribed: true });
    render(<KeepThisDevice publicKey={PUBLIC_KEY} knownDevice={null} />);
    await waitFor(() => expect(device.serviceWorker.register).toHaveBeenCalled());
    expect(saveDevice).not.toHaveBeenCalled();
  });
});
