import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../../test/fake-supabase";
import { processVideoImport, waitUntilReady } from "./import-job";

const ID = "22222222-2222-4222-8222-222222222222";
const wait = vi.fn(async () => {});

function admin(status = "processing", gemini_file = "files/abc", name = "Test pasta") {
  return fakeSupabase({ tables: { recipe_imports: [{ id: ID, name, gemini_file, status }] } });
}

const updates = (fake: ReturnType<typeof fakeSupabase>) =>
  fake.from.mock.results
    .map((result) => result.value as Record<string, ReturnType<typeof vi.fn>>)
    .flatMap((query) => query.update.mock.calls.map(([fields]) => fields));

const DRAFT = { name: "", cuisine: null, main_meat: null, cooking_method: null, cook_minutes: null, servings: null, ingredients: [], steps: ["Boil 1 box pasta."], notes: null, guessed: [] };

describe("reading an uploaded video after the phone moves on (REQ-112)", () => {
  it("waits for Google, keeps the draft as ready, and deletes the video", async () => {
    const fake = admin();
    const check = vi.fn().mockResolvedValueOnce({ state: "PROCESSING" }).mockResolvedValueOnce({ state: "ACTIVE", uri: "u", mimeType: "video/mp4" });
    const read = vi.fn(async () => ({ draft: DRAFT }));
    const discard = vi.fn(async () => {});
    await processVideoImport(fake as never, ID, { wait, check, read, discard });
    expect(read).toHaveBeenCalledWith("Test pasta", { uri: "u", mimeType: "video/mp4" });
    expect(updates(fake)).toEqual([expect.objectContaining({ status: "ready", draft: DRAFT, gemini_file: null })]);
    expect(discard).toHaveBeenCalledWith("files/abc");
  });

  it("names an unnamed video's import from what Gemini read, and doesn't tell Gemini the placeholder", async () => {
    const fake = admin("processing", "files/abc", "Recipe from a video");
    const check = vi.fn().mockResolvedValue({ state: "ACTIVE", uri: "u", mimeType: "video/mp4" });
    const read = vi.fn(async () => ({ draft: { ...DRAFT, name: "Test tikka" } }));
    await processVideoImport(fake as never, ID, { wait, check, read, discard: vi.fn(async () => {}) });
    expect(read).toHaveBeenCalledWith("", { uri: "u", mimeType: "video/mp4" });
    expect(updates(fake)).toEqual([expect.objectContaining({ status: "ready", name: "Test tikka" })]);
  });

  it("fails plainly when Gemini finds no recipe, keeps no draft, and still deletes the video", async () => {
    const fake = admin();
    const check = vi.fn(async () => ({ state: "ACTIVE" as const, uri: "u" }));
    const read = vi.fn(async () => ({ error: "Gemini found no recipe in it." }));
    const discard = vi.fn(async () => {});
    await processVideoImport(fake as never, ID, { wait, check, read, discard });
    expect(updates(fake)).toEqual([expect.objectContaining({ status: "failed", error: "Gemini found no recipe in it." })]);
    expect(updates(fake)[0]).not.toHaveProperty("draft");
    expect(discard).toHaveBeenCalledWith("files/abc");
  });

  it("fails when Google can't process the video, and deletes it", async () => {
    const fake = admin();
    const discard = vi.fn(async () => {});
    await processVideoImport(fake as never, ID, { wait, check: vi.fn(async () => ({ state: "FAILED" as const })), read: vi.fn(), discard });
    expect(updates(fake)).toEqual([expect.objectContaining({ status: "failed", error: "Google couldn't process the video." })]);
    expect(discard).toHaveBeenCalled();
  });

  it("only writes its result over a row still processing (not one removed or given up on)", async () => {
    const fake = admin();
    const check = vi.fn(async () => ({ state: "ACTIVE" as const, uri: "u" }));
    await processVideoImport(fake as never, ID, { wait, check, read: vi.fn(async () => ({ draft: DRAFT })), discard: vi.fn(async () => {}) });
    const query = fake.from.mock.results.map((r) => r.value as Record<string, ReturnType<typeof vi.fn>>).find((q) => q.update.mock.calls.length > 0)!;
    expect(query.eq).toHaveBeenCalledWith("status", "processing");
  });

  it("won't use a file name that isn't Google's, even with the row changed by hand", async () => {
    const fake = admin("processing", "../../v1beta/models");
    const check = vi.fn();
    const discard = vi.fn();
    await processVideoImport(fake as never, ID, { wait, check, read: vi.fn(), discard });
    expect(check).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it("leaves an import alone that isn't processing (already read, or removed)", async () => {
    const fake = admin("ready");
    const read = vi.fn();
    await processVideoImport(fake as never, ID, { wait, check: vi.fn(), read, discard: vi.fn() });
    expect(read).not.toHaveBeenCalled();
  });

  it("gives up waiting after its limit, counting unknown answers as not ready", async () => {
    const check = vi.fn(async () => ({ state: "UNKNOWN" as const }));
    expect(await waitUntilReady("files/abc", check, wait, 9000)).toEqual({ error: "Google took too long to process the video." });
    expect(check).toHaveBeenCalledTimes(4);
  });
});
