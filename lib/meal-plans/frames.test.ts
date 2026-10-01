import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../../test/fake-supabase";
import { framePath, keepDishFrames, readFrames, removeFrames } from "./frames";

const ID = "99999999-9999-4999-8999-999999999999";
const frames = ["a", "b", "c"].map((text) => new Blob([text], { type: "image/jpeg" }));

describe("a video's candidate photos (REQ-156)", () => {
  it("keeps only the frames Gemini named, in its order, each with its small copy", async () => {
    const fake = fakeSupabase();
    const kept = await keepDishFrames(fake as never, ID, frames, { pick: vi.fn(async () => [2, 0]) });
    expect(kept).toBe(2);
    expect(fake.storage.bucket.upload.mock.calls.map(([path]) => path)).toEqual([
      `imports/${ID}/frames/1.jpg`,
      `imports/${ID}/frames/1-thumb.jpg`,
      `imports/${ID}/frames/2.jpg`,
      `imports/${ID}/frames/2-thumb.jpg`,
    ]);
    expect((fake.storage.bucket.upload.mock.calls[0] as unknown[])[1]).toBe(frames[2]);
  });

  it("keeps nothing, and nothing random in its place, when none qualify", async () => {
    const fake = fakeSupabase();
    expect(await keepDishFrames(fake as never, ID, frames, { pick: vi.fn(async () => []) })).toBe(0);
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
  });

  it("lists a draft's candidates by number, ignoring small copies", async () => {
    const fake = fakeSupabase();
    fake.storage.bucket.list.mockResolvedValue({ data: [{ name: "2.jpg" }, { name: "1-thumb.jpg" }, { name: "1.jpg" }], error: null });
    expect(await readFrames(fake as never, ID)).toEqual([1, 2]);
  });

  it("removes them and their small copies", async () => {
    const fake = fakeSupabase();
    fake.storage.bucket.list.mockResolvedValue({ data: [{ name: "1.jpg" }], error: null });
    await removeFrames(fake as never, ID);
    expect(fake.storage.bucket.remove).toHaveBeenCalledWith([framePath(ID, 1), `imports/${ID}/frames/1-thumb.jpg`]);
  });
});
