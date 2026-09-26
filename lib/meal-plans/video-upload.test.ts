import { describe, expect, it, vi } from "vitest";
import { PIECE_BYTES, currentUploads, sendVideo } from "./video-upload";

const ok = () => new Response(null, { headers: { "X-Goog-Upload-Status": "active" } });
const offline = () => Promise.reject(new TypeError("Load failed"));

describe("sending a video to Google in pieces (REQ-112)", () => {
  it("sends 8 MB pieces at the right offsets, finalises with the last, and lets the server confirm", async () => {
    const file = new Blob([new Uint8Array(PIECE_BYTES * 2 + 10)]);
    // The last piece's answer can't be read in a browser (seen 2026-09-26).
    const send = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok()).mockImplementationOnce(offline);
    const check = vi.fn(async () => ({ done: true as const }));
    await sendVideo({ id: "i1", name: "Test", url: "https://upload.example/x", file, check }, { send });
    expect(send.mock.calls.map(([, init]) => init.headers)).toEqual([
      { "X-Goog-Upload-Command": "upload", "X-Goog-Upload-Offset": "0" },
      { "X-Goog-Upload-Command": "upload", "X-Goog-Upload-Offset": String(PIECE_BYTES) },
      { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": String(PIECE_BYTES * 2) },
    ]);
    expect(send.mock.calls.map(([, init]) => (init.body as Blob).size)).toEqual([PIECE_BYTES, PIECE_BYTES, 10]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(currentUploads()).toEqual([]);
  });

  it("after a piece fails, waits for the app to be on screen, asks the server what arrived, and carries on", async () => {
    const file = new Blob([new Uint8Array(PIECE_BYTES + 10)]);
    const waitForScreen = vi.fn(async () => {});
    const send = vi.fn().mockResolvedValueOnce(ok()).mockImplementationOnce(offline).mockResolvedValueOnce(ok());
    const check = vi
      .fn()
      .mockResolvedValueOnce({ received: PIECE_BYTES })
      .mockResolvedValueOnce({ done: true });
    await sendVideo({ id: "i2", name: "Test", url: "u", file, check }, { send, waitForScreen });
    expect(waitForScreen).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[2][1].headers).toEqual({ "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": String(PIECE_BYTES) });
  });

  it("counts failures in a row, so many pauses over a long upload don't make it give up", async () => {
    const file = new Blob([new Uint8Array(PIECE_BYTES * 25 + 10)]);
    // Every piece fails once (a switch to another app), then goes.
    let calls = 0;
    let received = 0;
    const send = vi.fn((_url: string, init: RequestInit) => {
      if (++calls % 2 === 1) return offline();
      received += (init.body as Blob).size;
      return Promise.resolve(ok());
    });
    const check = vi.fn(async () => (received >= file.size ? { done: true as const } : { received }));
    await sendVideo({ id: "i5", name: "Test", url: "u", file, check }, { send, waitForScreen: async () => {} });
    expect(received).toBe(file.size);
  });

  it("gives up after too many failures", async () => {
    const file = new Blob([new Uint8Array(PIECE_BYTES + 10)]);
    const send = vi.fn(offline);
    const check = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(sendVideo({ id: "i3", name: "Test", url: "u", file, check }, { send, waitForScreen: async () => {} })).rejects.toThrow(TypeError);
    expect(currentUploads()).toEqual([]);
  });

  it("stops when the server says the upload isn't one of ours", async () => {
    const file = new Blob([new Uint8Array(10)]);
    const check = vi.fn(async () => ({ error: "That upload isn't one of ours." }));
    await expect(
      sendVideo({ id: "i4", name: "Test", url: "u", file, check }, { send: vi.fn(async () => ok()), waitForScreen: async () => {} }),
    ).rejects.toThrow("That upload isn't one of ours.");
  });
});
