import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import { addEntry, removeEntry, updateEntry } from "./actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// Invented ids; nothing here is real.
const ENTRY = "11111111-1111-4111-8111-111111111111";

let fake: ReturnType<typeof fakeSupabase>;

// archivedFiles: how many paperwork files the box holds.
function given(archivedFiles = 0, permissions = ["use_modules"]) {
  fake = fakeSupabase({
    permissions,
    tables: {
      storage_entries: [{ id: ENTRY }],
      paperwork_files: Array.from({ length: archivedFiles }, (_, index) => ({ id: `f-${index}` })),
    },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const on = (table: string) =>
  fake.from.mock.calls
    .map(([name], index) => (name === table ? fake.from.mock.results[index].value : null))
    .filter(Boolean) as Record<string, ReturnType<typeof vi.fn>>[];

afterEach(() => vi.clearAllMocks());

describe("adding an entry (REQ-87)", () => {
  it("saves a box with its contents one per line, and opens its page to show the new ID", async () => {
    given();
    await expect(
      addEntry({}, form({ name: " Shoes ", isBox: "yes", contents: "Ski boots\n\n Sandals \n", note: "" })),
    ).rejects.toThrow(`REDIRECT:/storage/entries/${ENTRY}?new=1`);
    expect(on("storage_entries")[0].insert).toHaveBeenCalledWith({
      name: "Shoes",
      is_box: true,
      contents: "Ski boots\nSandals",
      note: null,
    });
  });

  it("keeps no contents for something that isn't a box", async () => {
    given();
    await expect(
      addEntry({}, form({ name: "Suitcases", contents: "left over", note: "Two of them" })),
    ).rejects.toThrow("REDIRECT");
    expect(on("storage_entries")[0].insert).toHaveBeenCalledWith({
      name: "Suitcases",
      is_box: false,
      contents: null,
      note: "Two of them",
    });
  });

  it("needs a name", async () => {
    given();
    expect(await addEntry({}, form({ name: "  " }))).toEqual({ error: "Give the entry a name." });
    expect(fake.from).not.toHaveBeenCalledWith("storage_entries");
  });

  it("is refused to someone who can't use modules", async () => {
    given(0, []);
    await expect(addEntry({}, form({ name: "Shoes" }))).rejects.toThrow("REDIRECT:/storage");
  });
});

describe("changing an entry (REQ-87)", () => {
  it("changes any field, box or not included, by its row; the ID isn't a field", async () => {
    given();
    expect(await updateEntry({}, form({ id: ENTRY, name: "Old shoes", isBox: "yes", contents: "Wellies" }))).toEqual({
      saved: true,
    });
    const [update] = on("storage_entries");
    expect(update.update).toHaveBeenCalledWith({ name: "Old shoes", is_box: true, contents: "Wellies", note: null });
    expect(update.eq).toHaveBeenCalledWith("id", ENTRY);
  });

  it("switches a box to not a box when it holds no paperwork files", async () => {
    given(0);
    expect(await updateEntry({}, form({ id: ENTRY, name: "Shoes" }))).toEqual({ saved: true });
    expect(on("storage_entries")[0].update).toHaveBeenCalledWith(expect.objectContaining({ is_box: false, contents: null }));
  });

  it("asks for archived paperwork files to move before a box stops being a box (REQ-98)", async () => {
    given(2);
    const result = await updateEntry({}, form({ id: ENTRY, name: "Shoes" }));
    expect(result.error).toContain("2 archived paperwork files");
    expect(result.error).toContain("first");
    expect(fake.from).not.toHaveBeenCalledWith("storage_entries");
  });
});

describe("removing an entry (REQ-87)", () => {
  it("removes it and goes back to the list", async () => {
    given(0);
    await expect(removeEntry({}, form({ id: ENTRY }))).rejects.toThrow("REDIRECT:/storage");
    expect(on("storage_entries")[0].delete).toHaveBeenCalled();
    expect(on("storage_entries")[0].eq).toHaveBeenCalledWith("id", ENTRY);
  });

  it("asks for archived paperwork files to move first (REQ-98)", async () => {
    given(1);
    expect((await removeEntry({}, form({ id: ENTRY }))).error).toContain("1 archived paperwork file.");
    expect(fake.from).not.toHaveBeenCalledWith("storage_entries");
  });
});
