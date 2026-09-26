// Sending a recipe video from the phone straight to Google (REQ-112,
// BETA), in pieces, so a pause doesn't mean starting over.
//
// An iPhone pauses a web app a few seconds after you switch to another
// app, and a web app can't ask to keep uploading the way a native app
// can. So the video goes in 8 MB pieces (the size Google asks for). When
// a piece fails, the upload waits until the app is back on screen, asks
// how much arrived, and carries on from there. It lives outside any one
// screen, so moving around HomeBase doesn't stop it; closing the app or
// reloading the page does, because the file goes with it.
//
// "How much arrived" is asked through our server (`check`), never from
// here: once the last piece lands, Google's answer can't be read by a
// browser (seen 2026-09-26), even though the upload worked. So after the
// last piece, whatever the browser saw, the server is asked.

// Google's X-Goog-Upload-Chunk-Granularity (seen 2026-09-26): every piece
// but the last must be a multiple of it.
export const PIECE_BYTES = 8 * 1024 * 1024;
const MAX_RESUMES = 20;

export type UploadProgress = { id: string; name: string; sent: number; total: number; paused: boolean };

// The server's answer: the whole video arrived, or this much of it.
export type Check = () => Promise<{ done: true } | { received: number } | { error: string }>;

type Send = (url: string, init: RequestInit) => Promise<Response>;

const uploads = new Map<string, UploadProgress>();
const listeners = new Set<() => void>();
// A fresh copy after every change, so a screen showing it knows to redraw.
let snapshot: UploadProgress[] = [];

function changed() {
  snapshot = [...uploads.values()].map((upload) => ({ ...upload }));
  for (const listener of listeners) listener();
}

export function watchUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentUploads(): UploadProgress[] {
  return snapshot;
}

// Resolves once the page is on screen again (after a short breath if it
// already is).
function backOnScreen(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    return new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return new Promise((resolve) => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      resolve();
    };
    document.addEventListener("visibilitychange", onVisible);
  });
}

// Sends `file` to the upload link; resolves once the server confirms
// Google has all of it. `send` and `waitForScreen` are there for tests.
export async function sendVideo(
  { id, name, url, file, check }: { id: string; name: string; url: string; file: Blob; check: Check },
  { send = fetch as Send, waitForScreen = backOnScreen }: { send?: Send; waitForScreen?: () => Promise<void> } = {},
): Promise<void> {
  const progress: UploadProgress = { id, name, sent: 0, total: file.size, paused: false };
  uploads.set(id, progress);
  changed();
  let offset = 0;
  let failures = 0;
  const pause = async (problem: unknown) => {
    if (++failures > MAX_RESUMES) throw problem;
    progress.paused = true;
    changed();
    await waitForScreen();
  };
  // Asks the server; true when the whole video has arrived.
  const arrived = async (): Promise<boolean> => {
    const answer = await check();
    if ("error" in answer) throw new Error(answer.error);
    if ("done" in answer) return true;
    offset = answer.received;
    progress.sent = offset;
    progress.paused = false;
    changed();
    return false;
  };
  try {
    while (true) {
      const end = Math.min(offset + PIECE_BYTES, file.size);
      const last = end === file.size;
      let went = false;
      try {
        const response = await send(url, {
          method: "POST",
          headers: {
            "X-Goog-Upload-Command": last ? "upload, finalize" : "upload",
            "X-Goog-Upload-Offset": String(offset),
          },
          body: file.slice(offset, end),
        });
        if (!response.ok && !last) throw new Error(`Google answered ${response.status}`);
        went = true;
      } catch (problem) {
        // The last piece "fails" in a browser even when it worked; only
        // the server's answer below says whether it did.
        if (!last) await pause(problem);
      }
      if (went && !last) {
        offset = end;
        progress.sent = offset;
        changed();
        continue;
      }
      // After the last piece, or a failed one: ask the server what arrived.
      try {
        if (await arrived()) return;
        if (last) await pause(new Error("The video didn't all arrive"));
      } catch (problem) {
        await pause(problem);
      }
    }
  } finally {
    uploads.delete(id);
    changed();
  }
}
