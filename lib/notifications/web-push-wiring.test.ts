// @vitest-environment node
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { KEEP_TRYING_FOR, MESSAGES } from "./send";

// The real library, not a stand-in. Nothing here goes near the network:
// web-push can build the request it *would* send, which is enough to prove
// our keys and settings produce something a push service would accept, and
// that the message leaves here encrypted. Until a real phone has signed up,
// this is the closest thing to proof we have.
function madeUpDevice() {
  const device = createECDH("prime256v1");
  device.generateKeys();
  return {
    endpoint: "https://web.push.apple.com/made-up-device",
    keys: {
      p256dh: device.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

describe("what actually goes to a push service", () => {
  const keys = webpush.generateVAPIDKeys();
  const message = JSON.stringify({ ...MESSAGES.hourly, url: "/" });

  function request() {
    webpush.setVapidDetails("https://homebase.example", keys.publicKey, keys.privateKey);
    return webpush.generateRequestDetails(madeUpDevice(), message, {
      TTL: KEEP_TRYING_FOR,
    });
  }

  it("is signed with the app's keys, so the push service knows it's us", () => {
    const { headers } = request();
    expect(String(headers.Authorization)).toMatch(
      /^vapid t=[\w-]+\.[\w-]+\.[\w-]+,\s*k=[\w-]+$/,
    );
    expect(String(headers.Authorization)).toContain(keys.publicKey);
  });

  it("is encrypted for that one device, not sent in the clear", () => {
    const { headers, body } = request();
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(Buffer.isBuffer(body)).toBe(true);
    expect((body as Buffer).includes("HomeBase")).toBe(false);
    expect((body as Buffer).includes("Hourly test")).toBe(false);
  });

  it("asks the push service to keep trying for half an hour, no longer", () => {
    const { method, headers } = request();
    expect(method).toBe("POST");
    expect(Number(headers.TTL)).toBe(KEEP_TRYING_FOR);
    expect(KEEP_TRYING_FOR).toBe(30 * 60);
  });

  it("uses a different encryption for every send, even of the same words", () => {
    expect(request().body).not.toEqual(request().body);
  });
});
