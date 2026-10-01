import { describe, expect, it } from "vitest";
import { fakeSupabase } from "../../test/fake-supabase";
import { framePath, readFrames, removeFrames } from "./frames";

const ID = "99999999-9999-4999-8999-999999999999";

describe("a video's candidate photo (REQ-156)", () => {
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
