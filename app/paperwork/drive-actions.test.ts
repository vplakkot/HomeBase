import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as drive from "../../lib/paperwork/drive";
import { createClient } from "../../lib/supabase/server";
import { fakeSupabase } from "../../test/fake-supabase";
import {
  archiveDriveDocument,
  archiveDriveFile,
  bringBackDriveDocument,
  bringBackDriveFile,
  connectDrive,
  fileDriveDocument,
  fixFolderName,
  ignoreFolder,
  linkDriveFolder,
  linkUnlinkedFolder,
  refreshDrive,
  removeMissingDocument,
  setDocumentOwner,
} from "./drive-actions";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("../../lib/paperwork/drive", async (original) => ({
  ...(await original<typeof import("../../lib/paperwork/drive")>()),
  getItem: vi.fn(),
  listChildren: vi.fn(),
  moveItem: vi.fn(),
  renameItem: vi.fn(),
  serviceAccountEmail: vi.fn(),
}));

// Invented ids; nothing here is real.
const FILE = "11111111-1111-4111-8111-111111111111";
const OTHER_FILE = "22222222-2222-4222-8222-222222222222";
const TAXES = "33333333-3333-4333-8333-333333333333";
const ALEX = "55555555-5555-4555-8555-555555555555";
const CONNECTION = { folder_id: "top", archived_folder_id: "arch", synced_at: null };
const ROBOT = "robot@example.iam.gserviceaccount.com";

let fake: ReturnType<typeof fakeSupabase>;

const ADMIN = ["use_modules", "manage_paperwork"];

function given(permissions: string[] = ["use_modules"], tables: Record<string, unknown[]> = {}) {
  fake = fakeSupabase({
    permissions,
    tables: {
      paperwork_drive: [CONNECTION],
      paperwork_categories: [{ name: "Taxes" }],
      paperwork_files: [{ id: FILE, number: 5, label: "Returns", category_id: TAXES, status: "active", drive_folder_id: "fold-5" }],
      paperwork_drive_documents: [{ drive_id: "doc-1", parent_id: "top", name: "Lease.pdf" }],
      ...tables,
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
const updates = (table: string) => on(table).flatMap((query) => query.update.mock.calls.map((call) => call[0]));
const upserts = (table: string) => on(table).flatMap((query) => query.upsert.mock.calls.map((call) => call[0]));

const item = (over: Partial<drive.DriveItem> & { id: string; name: string }): drive.DriveItem => ({
  isFolder: true, parents: ["top"], mimeType: drive.FOLDER_MIME, link: null, ownerEmail: null, ...over,
});

beforeEach(() => {
  vi.mocked(drive.serviceAccountEmail).mockReturnValue(ROBOT);
  vi.mocked(drive.getItem).mockResolvedValue(item({ id: "top", name: "HomeBase Paperwork", parents: [] }));
  vi.mocked(drive.listChildren).mockResolvedValue([item({ id: "arch", name: "Archived" })]);
  vi.mocked(drive.moveItem).mockResolvedValue(undefined);
  vi.mocked(drive.renameItem).mockResolvedValue(undefined);
});
afterEach(() => vi.resetAllMocks());

describe("connecting a folder (REQ-152)", () => {
  const LINK = "https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456";

  it("is the admin's alone", async () => {
    given(["use_modules"]);
    await expect(connectDrive({}, form({ link: LINK }))).rejects.toThrow("REDIRECT:/paperwork");
  });

  it("saves the folder and its Archived sub-folder when it can read both", async () => {
    given(ADMIN, { paperwork_drive: [] });
    const result = await connectDrive({}, form({ link: LINK }));
    expect(result).toEqual({ saved: true });
    expect(upserts("paperwork_drive")[0]).toEqual({
      id: true,
      folder_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456",
      archived_folder_id: "arch",
    });
  });

  it("says it can't read the folder and who to share it with", async () => {
    given(ADMIN);
    vi.mocked(drive.getItem).mockResolvedValue(null);
    const result = await connectDrive({}, form({ link: LINK }));
    expect(result.error).toContain(ROBOT);
    expect(upserts("paperwork_drive")).toHaveLength(0);
  });

  it("says there's no Archived sub-folder, apart from not reading the folder", async () => {
    given(ADMIN);
    vi.mocked(drive.listChildren).mockResolvedValue([item({ id: "x", name: "Receipts" })]);
    const result = await connectDrive({}, form({ link: LINK }));
    expect(result.error).toMatch(/no sub-folder called Archived/);
    expect(result.error).not.toContain("Share it with");
  });

  it("refuses text that isn't a Drive link", async () => {
    given(ADMIN);
    expect((await connectDrive({}, form({ link: "hello there" }))).error).toMatch(/doesn't look like/);
  });

  it("says when the key isn't on the server yet", async () => {
    given(ADMIN);
    vi.mocked(drive.serviceAccountEmail).mockReturnValue(null);
    expect((await connectDrive({}, form({ link: LINK }))).error).toMatch(/key isn't set up/);
  });

  it("won't swap the folder once Drive files are linked to the old one", async () => {
    given(ADMIN, { paperwork_drive: [{ ...CONNECTION, folder_id: "old-folder" }] });
    expect((await connectDrive({}, form({ link: LINK }))).error).toMatch(/already linked/);
    expect(upserts("paperwork_drive")).toHaveLength(0);
  });
});

describe("linking a waiting file to its folder (REQ-152)", () => {
  const waiting = { id: FILE, number: 5, label: "Returns", category_id: TAXES, status: "active", drive_folder_id: null };

  it("finds the sub-folder starting with the file's ID and links it by its Drive ID", async () => {
    given(["use_modules"], { paperwork_files: [waiting] });
    vi.mocked(drive.listChildren).mockResolvedValue([
      item({ id: "arch", name: "Archived" }),
      item({ id: "F4", name: "F-0004_Taxes" }),
      item({ id: "F5", name: "F-0005_Taxes_Returns" }),
    ]);
    expect(await linkDriveFolder({}, form({ id: FILE }))).toEqual({ saved: true });
    expect(updates("paperwork_files")[0]).toEqual({ drive_folder_id: "F5" });
  });

  it("says it wasn't found, and the file stays waiting", async () => {
    given(["use_modules"], { paperwork_files: [waiting] });
    vi.mocked(drive.listChildren).mockResolvedValue([item({ id: "F4", name: "F-0004_Taxes" })]);
    const result = await linkDriveFolder({}, form({ id: FILE }));
    expect(result.error).toMatch(/F-0005_/);
    expect(updates("paperwork_files")).toHaveLength(0);
  });

  it("only looks in the connected folder, never matching a loose document", async () => {
    given(["use_modules"], { paperwork_files: [waiting] });
    vi.mocked(drive.listChildren).mockResolvedValue([item({ id: "d", name: "F-0005_notes.pdf", isFolder: false })]);
    expect((await linkDriveFolder({}, form({ id: FILE }))).error).toBeDefined();
  });

  it("needs a connected folder", async () => {
    given(["use_modules"], { paperwork_files: [waiting], paperwork_drive: [] });
    expect((await linkDriveFolder({}, form({ id: FILE }))).error).toMatch(/isn't connected/);
  });

  it("lets the admin link an unlinked folder to a waiting file, or ignore it", async () => {
    given(ADMIN, { paperwork_files: [waiting] });
    expect(await linkUnlinkedFolder({}, form({ folderId: "stray", fileId: FILE }))).toEqual({ saved: true });
    expect(updates("paperwork_files")[0]).toEqual({ drive_folder_id: "stray" });
    await ignoreFolder(form({ folderId: "stray" }));
    expect(updates("paperwork_drive_folders")).toEqual([{ ignored: true }]);
  });

  it("keeps both of those for the admin", async () => {
    given(["use_modules"]);
    await expect(linkUnlinkedFolder({}, form({ folderId: "s", fileId: FILE }))).rejects.toThrow("REDIRECT");
    await expect(ignoreFolder(form({ folderId: "s" }))).rejects.toThrow("REDIRECT");
  });
});

describe("filing a Drive document (REQ-152)", () => {
  it("moves it into the file's folder in Drive and confirms the owner", async () => {
    given();
    const result = await fileDriveDocument({}, form({ documentId: "doc-1", fileId: FILE, ownerId: ALEX }));
    expect(result).toEqual({ saved: true });
    expect(drive.moveItem).toHaveBeenCalledWith("doc-1", "top", "fold-5");
    expect(updates("paperwork_drive_documents")[0]).toEqual({ parent_id: "fold-5", owner_id: ALEX, owner_set: true });
  });

  it("takes Joint as an owner", async () => {
    given();
    await fileDriveDocument({}, form({ documentId: "doc-1", fileId: FILE, ownerId: "joint" }));
    expect(updates("paperwork_drive_documents")[0]).toMatchObject({ owner_id: null, owner_set: true });
  });

  it("won't file without an owner chosen", async () => {
    given();
    const result = await fileDriveDocument({}, form({ documentId: "doc-1", fileId: FILE, ownerId: "" }));
    expect(result.error).toMatch(/whose it is/);
    expect(drive.moveItem).not.toHaveBeenCalled();
  });

  it("only goes into a Drive file that has its folder and is active", async () => {
    given(["use_modules"], { paperwork_files: [{ id: FILE, number: 5, status: "active", drive_folder_id: null }] });
    expect((await fileDriveDocument({}, form({ documentId: "doc-1", fileId: FILE, ownerId: "joint" }))).error).toMatch(/no Drive folder/);
    given(["use_modules"], { paperwork_files: [{ id: FILE, number: 5, status: "archived", drive_folder_id: "f" }] });
    expect((await fileDriveDocument({}, form({ documentId: "doc-1", fileId: FILE, ownerId: "joint" }))).error).toMatch(/archived/);
    given(["use_modules"], { paperwork_files: [] });
    expect((await fileDriveDocument({}, form({ documentId: "doc-1", fileId: OTHER_FILE, ownerId: "joint" }))).error).toBeDefined();
    expect(drive.moveItem).not.toHaveBeenCalled();
  });

  it("changes nothing here when Drive says no", async () => {
    given();
    vi.mocked(drive.moveItem).mockRejectedValue(new drive.DriveError("Google Drive said no: nope"));
    const result = await fileDriveDocument({}, form({ documentId: "doc-1", fileId: FILE, ownerId: "joint" }));
    expect(result.error).toMatch(/said no/);
    expect(updates("paperwork_drive_documents")).toHaveLength(0);
  });

  it("sets the owner of a document that arrived without one", async () => {
    given();
    expect(await setDocumentOwner({}, form({ documentId: "doc-1", ownerId: ALEX }))).toEqual({ saved: true });
    expect(updates("paperwork_drive_documents")[0]).toEqual({ owner_id: ALEX, owner_set: true });
    expect((await setDocumentOwner({}, form({ documentId: "doc-1", ownerId: "" }))).error).toBeDefined();
  });
});

describe("archiving Drive documents (REQ-153)", () => {
  it("moves a document loose into Archived", async () => {
    given();
    await archiveDriveDocument(form({ documentId: "doc-1" }));
    expect(drive.moveItem).toHaveBeenCalledWith("doc-1", "top", "arch");
    expect(updates("paperwork_drive_documents")[0]).toEqual({ parent_id: "arch" });
  });

  it("moves a filed document out of its file's folder too", async () => {
    given(["use_modules"], { paperwork_drive_documents: [{ drive_id: "doc-1", parent_id: "fold-5", name: "x" }] });
    await archiveDriveDocument(form({ documentId: "doc-1" }));
    expect(drive.moveItem).toHaveBeenCalledWith("doc-1", "fold-5", "arch");
  });

  it("brings an archived document back to the top of the connected folder (Unfiled)", async () => {
    given(["use_modules"], { paperwork_drive_documents: [{ drive_id: "doc-1", parent_id: "arch", name: "x" }] });
    await bringBackDriveDocument(form({ documentId: "doc-1" }));
    expect(drive.moveItem).toHaveBeenCalledWith("doc-1", "arch", "top");
    expect(updates("paperwork_drive_documents")[0]).toEqual({ parent_id: "top" });
  });

  it("does nothing, and says nothing wrong, when the document is already there", async () => {
    given(["use_modules"], { paperwork_drive_documents: [{ drive_id: "doc-1", parent_id: "arch", name: "x" }] });
    await archiveDriveDocument(form({ documentId: "doc-1" }));
    expect(drive.moveItem).not.toHaveBeenCalled();
  });
});

describe("archiving a Drive file (REQ-152)", () => {
  it("moves its folder into Archived and marks it archived", async () => {
    given();
    expect(await archiveDriveFile({}, form({ id: FILE }))).toEqual({ saved: true });
    expect(drive.moveItem).toHaveBeenCalledWith("fold-5", "top", "arch");
    expect(updates("paperwork_files")).toEqual([{ status: "archived" }]);
    expect(updates("paperwork_drive_folders")).toEqual([{ in_archived: true }]);
  });

  it("moves it back to the top level and marks it active", async () => {
    given();
    expect(await bringBackDriveFile({}, form({ id: FILE }))).toEqual({ saved: true });
    expect(drive.moveItem).toHaveBeenCalledWith("fold-5", "arch", "top");
    expect(updates("paperwork_files")).toEqual([{ status: "active" }]);
  });

  it("changes nothing when Drive refuses the move", async () => {
    given();
    vi.mocked(drive.moveItem).mockRejectedValue(new drive.DriveError("Google Drive said no: nope"));
    expect((await archiveDriveFile({}, form({ id: FILE }))).error).toMatch(/said no/);
    expect(updates("paperwork_files")).toHaveLength(0);
  });

  it("has no folder to move while it's still waiting for one", async () => {
    given(["use_modules"], { paperwork_files: [{ id: FILE, number: 5, status: "active", drive_folder_id: null }] });
    expect((await archiveDriveFile({}, form({ id: FILE }))).error).toMatch(/no Drive folder/);
  });
});

describe("keeping folder names right (REQ-152)", () => {
  it("renames a folder to the expected name, for the admin", async () => {
    given(ADMIN);
    await fixFolderName(form({ id: FILE }));
    expect(drive.renameItem).toHaveBeenCalledWith("fold-5", "F-0005_Taxes_Returns");
    expect(updates("paperwork_drive_folders")).toEqual([{ name: "F-0005_Taxes_Returns" }]);
  });

  it("is the admin's alone", async () => {
    given(["use_modules"]);
    await expect(fixFolderName(form({ id: FILE }))).rejects.toThrow("REDIRECT");
  });
});

describe("a document Drive no longer has (REQ-152)", () => {
  it("has its record removed by the admin, only while it's missing", async () => {
    given(ADMIN);
    await removeMissingDocument(form({ documentId: "doc-1" }));
    const query = on("paperwork_drive_documents")[0];
    expect(query.delete).toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("missing", true);
  });

  it("is not for a member to do", async () => {
    given(["use_modules"]);
    await expect(removeMissingDocument(form({ documentId: "doc-1" }))).rejects.toThrow("REDIRECT");
  });
});

describe("Refresh (REQ-152 Sync)", () => {
  it("is for any member, and reads the folder", async () => {
    given();
    vi.mocked(drive.listChildren).mockResolvedValue([]);
    expect(await refreshDrive()).toEqual({ saved: true });
    expect(fake.rpc).toHaveBeenCalledWith("record_drive_sync");
  });

  it("says why when the folder can't be seen", async () => {
    given();
    vi.mocked(drive.getItem).mockResolvedValue(null);
    expect((await refreshDrive()).error).toMatch(/can't see the connected/);
  });

  it("does nothing for someone who isn't a member", async () => {
    given([]);
    expect((await refreshDrive()).error).toBeDefined();
    expect(drive.listChildren).not.toHaveBeenCalled();
  });
});
