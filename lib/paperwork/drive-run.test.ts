import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../../test/fake-supabase";
import * as drive from "./drive";
import { renameFoldersInCategory, syncDrive } from "./drive-run";

vi.mock("./drive", async (original) => ({
  ...(await original<typeof import("./drive")>()),
  getItem: vi.fn(),
  listChildren: vi.fn(),
  renameItem: vi.fn(),
}));

const CONNECTION = { folder_id: "top", archived_folder_id: "arch", synced_at: null };
const item = (over: Partial<drive.DriveItem> & { id: string; name: string }): drive.DriveItem => ({
  isFolder: true, parents: ["top"], mimeType: drive.FOLDER_MIME, link: null, ownerEmail: null, ...over,
});

type Fake = ReturnType<typeof fakeSupabase>;
const client = (fake: Fake) => fake as unknown as Parameters<typeof syncDrive>[0];
const on = (fake: Fake, table: string) =>
  fake.from.mock.calls
    .map(([name], index) => (name === table ? fake.from.mock.results[index].value : null))
    .filter(Boolean) as Record<string, ReturnType<typeof vi.fn>>[];
const calls = (fake: Fake, table: string, method: string) => on(fake, table).flatMap((query) => query[method].mock.calls);

beforeEach(() => {
  vi.mocked(drive.getItem).mockResolvedValue(item({ id: "top", name: "HomeBase Paperwork", parents: [] }));
  vi.mocked(drive.renameItem).mockResolvedValue(undefined);
});
afterEach(() => vi.resetAllMocks());

describe("syncDrive (REQ-152 Sync)", () => {
  it("does nothing when no folder is connected", async () => {
    const fake = fakeSupabase({ tables: { paperwork_drive: [] } });
    expect(await syncDrive(client(fake))).toEqual({});
    expect(drive.listChildren).not.toHaveBeenCalled();
  });

  it("reads the folder, Archived and each linked file's folder, and saves what it found", async () => {
    vi.mocked(drive.listChildren)
      .mockResolvedValueOnce([item({ id: "arch", name: "Archived" }), item({ id: "fold-5", name: "F-0005_Taxes" }), item({ id: "d-loose", name: "Loose.pdf", isFolder: false })])
      .mockResolvedValueOnce([item({ id: "d-in", name: "Lease.pdf", isFolder: false, parents: ["fold-5"], ownerEmail: "alex@example.com" })]);
    const fake = fakeSupabase({
      tables: {
        paperwork_drive: [CONNECTION],
        paperwork_files: [{ id: "file-5", status: "active", drive_folder_id: "fold-5" }],
        paperwork_drive_folders: [],
        paperwork_drive_documents: [],
        household_members: [{ user_id: "u-alex", google_email: "alex@example.com" }],
      },
    });
    expect(await syncDrive(client(fake))).toEqual({});
    // The second read is of the linked file's folder only.
    expect(vi.mocked(drive.listChildren).mock.calls[1][0]).toEqual(["fold-5"]);
    const saved = calls(fake, "paperwork_drive_documents", "upsert")[0][0];
    expect(saved.map((row: { drive_id: string; owner_id: string | null }) => [row.drive_id, row.owner_id])).toEqual([
      ["d-loose", null],
      ["d-in", "u-alex"],
    ]);
    expect(calls(fake, "paperwork_drive_folders", "upsert")[0][0]).toHaveLength(1);
    expect(fake.rpc).toHaveBeenCalledWith("record_drive_sync");
  });

  it("marks what's gone from Drive as missing, never deleting it", async () => {
    vi.mocked(drive.listChildren).mockResolvedValue([item({ id: "arch", name: "Archived" })]);
    const fake = fakeSupabase({
      tables: {
        paperwork_drive: [CONNECTION],
        paperwork_files: [],
        paperwork_drive_folders: [{ drive_id: "old-folder", name: "x", in_archived: false, ignored: false, missing: false }],
        paperwork_drive_documents: [{ drive_id: "old-doc", name: "x", parent_id: "top", owner_id: null, owner_set: false, missing: false }],
        household_members: [],
      },
    });
    await syncDrive(client(fake));
    expect(calls(fake, "paperwork_drive_folders", "update")[0][0]).toEqual({ missing: true });
    expect(calls(fake, "paperwork_drive_documents", "update")[0][0]).toEqual({ missing: true });
    expect(calls(fake, "paperwork_drive_documents", "delete")).toHaveLength(0);
  });

  it("follows a File's folder into Archived by moving the file's status, and back", async () => {
    vi.mocked(drive.listChildren)
      .mockResolvedValueOnce([item({ id: "arch", name: "Archived" }), item({ id: "fold-5", name: "F-0005_Taxes", parents: ["arch"] })])
      .mockResolvedValueOnce([]);
    const fake = fakeSupabase({
      tables: {
        paperwork_drive: [CONNECTION],
        paperwork_files: [{ id: "file-5", status: "active", drive_folder_id: "fold-5" }],
        paperwork_drive_folders: [],
        paperwork_drive_documents: [],
        household_members: [],
      },
    });
    await syncDrive(client(fake));
    expect(calls(fake, "paperwork_files", "update").map((call) => call[0])).toEqual([{ status: "archived" }]);

    vi.mocked(drive.listChildren)
      .mockResolvedValueOnce([item({ id: "arch", name: "Archived" }), item({ id: "fold-5", name: "F-0005_Taxes" })])
      .mockResolvedValueOnce([]);
    const again = fakeSupabase({
      tables: {
        paperwork_drive: [CONNECTION],
        paperwork_files: [{ id: "file-5", status: "archived", drive_folder_id: "fold-5" }],
        paperwork_drive_folders: [],
        paperwork_drive_documents: [],
        household_members: [],
      },
    });
    await syncDrive(client(again));
    expect(calls(again, "paperwork_files", "update").map((call) => call[0])).toEqual([{ status: "active" }]);
  });

  it("leaves a File's status alone when its folder hasn't moved", async () => {
    vi.mocked(drive.listChildren)
      .mockResolvedValueOnce([item({ id: "arch", name: "Archived" }), item({ id: "fold-5", name: "F-0005_Taxes" })])
      .mockResolvedValueOnce([]);
    const fake = fakeSupabase({
      tables: {
        paperwork_drive: [CONNECTION],
        paperwork_files: [{ id: "file-5", status: "active", drive_folder_id: "fold-5" }],
        paperwork_drive_folders: [],
        paperwork_drive_documents: [],
        household_members: [],
      },
    });
    await syncDrive(client(fake));
    expect(calls(fake, "paperwork_files", "update")).toHaveLength(0);
  });

  it("says so, and marks nothing missing, when the connected folder itself can't be seen", async () => {
    vi.mocked(drive.getItem).mockResolvedValue(null);
    const fake = fakeSupabase({ tables: { paperwork_drive: [CONNECTION] } });
    expect((await syncDrive(client(fake))).error).toMatch(/can't see the connected/);
    expect(drive.listChildren).not.toHaveBeenCalled();
  });

  it("says so, and marks nothing missing, when the Archived folder can't be seen", async () => {
    vi.mocked(drive.getItem).mockResolvedValueOnce(item({ id: "top", name: "HomeBase Paperwork", parents: [] })).mockResolvedValueOnce(null);
    const fake = fakeSupabase({ tables: { paperwork_drive: [CONNECTION] } });
    expect((await syncDrive(client(fake))).error).toMatch(/Archived folder/);
    expect(drive.listChildren).not.toHaveBeenCalled();
  });

  it("reports a Drive failure in words", async () => {
    vi.mocked(drive.listChildren).mockRejectedValue(new drive.DriveError("Google Drive said no: nope"));
    const fake = fakeSupabase({ tables: { paperwork_drive: [CONNECTION], paperwork_files: [], paperwork_drive_folders: [], paperwork_drive_documents: [], household_members: [] } });
    expect((await syncDrive(client(fake))).error).toBe("Google Drive said no: nope");
  });
});

describe("renameFoldersInCategory (REQ-152)", () => {
  const folders = [
    { drive_id: "fold-5", name: "F-0005_Old name_Returns", missing: false },
    { drive_id: "fold-6", name: "F-0006_Taxes", missing: false },
    { drive_id: "fold-7", name: "F-0007_Old name", missing: true },
  ];
  const files = [
    { number: 5, label: "Returns", drive_folder_id: "fold-5" },
    { number: 6, label: null, drive_folder_id: "fold-6" },
    { number: 7, label: null, drive_folder_id: "fold-7" },
  ];

  it("renames each linked folder whose name no longer matches, and nothing else", async () => {
    const fake = fakeSupabase({ tables: { paperwork_files: files, paperwork_drive_folders: folders } });
    const failed = await renameFoldersInCategory(client(fake), { id: "c", name: "Taxes", keep_years: null });
    expect(failed).toBe(0);
    expect(drive.renameItem).toHaveBeenCalledTimes(1);
    expect(drive.renameItem).toHaveBeenCalledWith("fold-5", "F-0005_Taxes_Returns");
    expect(calls(fake, "paperwork_drive_folders", "update")[0][0]).toEqual({ name: "F-0005_Taxes_Returns" });
  });

  it("counts the folders Drive wouldn't rename", async () => {
    vi.mocked(drive.renameItem).mockRejectedValue(new drive.DriveError("nope"));
    const fake = fakeSupabase({ tables: { paperwork_files: files, paperwork_drive_folders: folders } });
    expect(await renameFoldersInCategory(client(fake), { id: "c", name: "Taxes", keep_years: null })).toBe(1);
  });
});
