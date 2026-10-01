import { beforeEach, describe, expect, it, vi } from "vitest";
import { cutDraftPhotos } from "./draft-photo";
import { hasVideo, keepVideo, takeVideo } from "./kept-video";

vi.mock("../../app/meal-plans/actions", () => ({ setDraftFrame: vi.fn() }));

const video = new Blob(["v"]);
const frame = new Blob(["f"], { type: "image/jpeg" });

beforeEach(() => {
  for (const id of ["a", "b", "c", "d"]) takeVideo(id);
  for (const id of ["a", "b", "c", "d"]) keepVideo(id, video);
});

describe("cutting the photo Gemini chose out of the video this phone kept (REQ-156)", () => {
  it("cuts that second, sends the frame to wait beside the draft, and lets the video go", async () => {
    const cut = vi.fn(async () => frame);
    const send = vi.fn(async (_data: FormData) => ({ saved: true }));
    await cutDraftPhotos([{ id: "a", status: "ready", photo_at: 48.5 }], { cut, send });
    expect(cut).toHaveBeenCalledWith(video, 48.5);
    const data = send.mock.calls[0][0];
    expect(data.get("import_id")).toBe("a");
    expect(data.get("frame")).toBeInstanceOf(File);
    expect(hasVideo("a")).toBe(false);
  });

  it("waits while the recipe is still being read, keeping the video", async () => {
    const cut = vi.fn();
    await cutDraftPhotos([{ id: "b", status: "processing", photo_at: null }], { cut });
    expect(cut).not.toHaveBeenCalled();
    expect(hasVideo("b")).toBe(true);
  });

  it("lets the video go without cutting when nothing qualified or the read failed", async () => {
    const cut = vi.fn();
    await cutDraftPhotos([{ id: "c", status: "ready", photo_at: null }, { id: "d", status: "failed", photo_at: null }], { cut });
    expect(cut).not.toHaveBeenCalled();
    expect(hasVideo("c") || hasVideo("d")).toBe(false);
  });

  it("leaves the draft without a photo when the frame can't be cut or sent", async () => {
    const send = vi.fn();
    await cutDraftPhotos([{ id: "a", status: "ready", photo_at: 1 }], { cut: vi.fn(async () => null), send });
    await cutDraftPhotos([{ id: "b", status: "ready", photo_at: 1 }], {
      cut: vi.fn(async () => {
        throw new Error("no video");
      }),
      send,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("lets go of a video whose draft was removed meanwhile, so it doesn't sit in memory", async () => {
    await cutDraftPhotos([{ id: "a", status: "processing", photo_at: null }], { cut: vi.fn() });
    expect(hasVideo("a")).toBe(true);
    expect(hasVideo("b") || hasVideo("c") || hasVideo("d")).toBe(false);
  });

  it("does nothing for an import this tab never had the video of", async () => {
    const cut = vi.fn();
    await cutDraftPhotos([{ id: "elsewhere", status: "ready", photo_at: 5 }], { cut });
    expect(cut).not.toHaveBeenCalled();
  });
});
