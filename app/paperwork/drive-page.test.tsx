// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import DriveArchivePage from "./archives/drive/page";
import FilePage from "./files/[id]/page";
import LocationPage from "./locations/[id]/page";
import PaperworkPage from "./page";
import PaperworkSettingsPage from "./settings/page";
import UnfiledPage from "./unfiled/page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/paperwork",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
// The server actions are tested in drive-actions.test.ts; here they're
// stand-ins, so a screen opening doesn't try to reach Drive.
vi.mock("./drive-actions", () => ({
  refreshDrive: vi.fn(async () => ({ saved: true })),
  connectDrive: vi.fn(),
  linkDriveFolder: vi.fn(),
  linkUnlinkedFolder: vi.fn(),
  ignoreFolder: vi.fn(),
  fixFolderName: vi.fn(),
  fileDriveDocument: vi.fn(),
  setDocumentOwner: vi.fn(),
  archiveDriveDocument: vi.fn(),
  bringBackDriveDocument: vi.fn(),
  removeMissingDocument: vi.fn(),
  archiveDriveFile: vi.fn(),
  bringBackDriveFile: vi.fn(),
}));
vi.mock("../../lib/paperwork/drive", async (original) => ({
  ...(await original<typeof import("../../lib/paperwork/drive")>()),
  serviceAccountEmail: () => "robot@example.iam.gserviceaccount.com",
}));

beforeAll(installDialogStandIn);
afterEach(cleanup);

// An invented household, folder and documents; nothing here is real.
const PEOPLE = [
  { user_id: "u-alex", name: "Alex", manages_budget: true },
  { user_id: "u-sam", name: "Sam", manages_budget: false },
];
const MEMBERS = [
  { user_id: "u-alex", google_email: "alex@example.com" },
  { user_id: "u-sam", google_email: null },
];
const TAXES = { id: "c-tax", name: "Taxes", keep_years: 7 };
const HALL = { id: "10ca0000-0000-4000-8000-000000000001", name: "Hall cupboard", built_in: null };
const DRIVE = { id: "10ca0000-0000-4000-8000-0000000000d1", name: "Google Drive", built_in: "drive" };
const CONNECTION = { folder_id: "top", archived_folder_id: "arch", synced_at: "2026-10-06T12:00:00Z" };

const base = { storage_entry_id: null, is_drive: false, drive_folder_id: null, status: "active" };
const PHYSICAL = { ...base, id: "f-1", number: 1, category_id: TAXES.id, location_id: HALL.id, label: "Paper returns" };
const waiting = { ...base, id: "f-5", number: 5, category_id: TAXES.id, location_id: DRIVE.id, label: "2025 Returns", is_drive: true };
const linked = { ...waiting, id: "f-6", number: 6, label: "Leases", drive_folder_id: "fold-6" };
const archivedFile = { ...waiting, id: "f-7", number: 7, label: "Old taxes", drive_folder_id: "fold-7", status: "archived" };

const FOLDERS = [
  { drive_id: "fold-6", name: "F-0006_Taxes_Leases", in_archived: false, ignored: false, missing: false },
  { drive_id: "fold-7", name: "F-0007_Taxes_Old taxes", in_archived: true, ignored: false, missing: false },
  { drive_id: "stray", name: "Receipts 2019", in_archived: false, ignored: false, missing: false },
];
const doc = (drive_id: string, name: string, parent_id: string, over: Record<string, unknown> = {}) => ({
  drive_id, name, mime_type: "application/pdf", link: `https://drive.example/${drive_id}`, drive_owner_email: null,
  parent_id, owner_id: null, owner_set: false, missing: false, ...over,
});
const DOCS = [
  doc("d-loose", "Scan0042.pdf", "top", { drive_owner_email: "alex@example.com" }),
  doc("d-set", "Lease 2025.pdf", "fold-6", { owner_id: "u-sam", owner_set: true }),
  doc("d-unset", "Renewal.pdf", "fold-6"),
  doc("d-gone", "Old lease.pdf", "fold-6", { missing: true }),
  doc("d-arch", "Tax 2012.pdf", "arch", { owner_set: true }),
];

function given(
  permissions = ["use_modules"],
  { files = [PHYSICAL, waiting, linked, archivedFile] as unknown[], connection = [CONNECTION] as unknown[], folders = FOLDERS as unknown[], docs = DOCS as unknown[] } = {},
) {
  const fake = fakeSupabase({
    permissions,
    people: PEOPLE,
    tables: {
      paperwork_categories: [TAXES],
      paperwork_files: files,
      paperwork: [],
      paperwork_locations: [HALL, DRIVE],
      paperwork_archives: [],
      storage_entries: [],
      paperwork_drive: connection,
      paperwork_drive_folders: folders,
      paperwork_drive_documents: docs,
      household_members: MEMBERS,
    },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
  return fake;
}

const ADMIN = ["use_modules", "manage_members", "manage_paperwork"];
const q = Promise.resolve({});
const region = (name: string) => screen.getByRole("region", { name });
const openFile = (id: string) => FilePage({ params: Promise.resolve({ id }), searchParams: q });

describe("Google Drive on the Overview (REQ-152)", () => {
  it("shows loose Drive documents in Unfiled · Google Drive, with whose they are in Drive", async () => {
    given();
    render(await PaperworkPage({ searchParams: q }));
    const section = region("Unfiled · Google Drive");
    expect(within(section).getByRole("link", { name: "Scan0042.pdf" }).getAttribute("href")).toBe("https://drive.example/d-loose");
    expect(within(section).getByText("Owned by Alex in Drive")).toBeDefined();
    expect(within(section).queryByText("Lease 2025.pdf")).toBeNull();
  });

  it("has no Drive section until a folder is connected", async () => {
    given(["use_modules"], { connection: [] });
    render(await PaperworkPage({ searchParams: q }));
    expect(screen.queryByRole("region", { name: "Unfiled · Google Drive" })).toBeNull();
  });

  it("shows Google Drive as a location, and its Archived folder with the archived file and loose documents", async () => {
    given();
    render(await PaperworkPage({ searchParams: q }));
    expect(within(region("Locations")).getByText("Google Drive")).toBeDefined();
    const archived = region("Archived in storage");
    expect(within(archived).getByText("Google Drive · Archived")).toBeDefined();
    expect(within(archived).getByText("2 files · 1 document")).toBeDefined();
  });

  it("says when it last synced and has a Refresh button", async () => {
    given();
    render(await PaperworkPage({ searchParams: q }));
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDefined();
    await waitFor(() => expect(screen.getByText(/Google Drive · (Synced|Syncing)/)).toBeDefined());
  });

  it("gives the admin the Unlinked folders, and a way to link or ignore each", async () => {
    given(ADMIN);
    render(await PaperworkPage({ searchParams: q }));
    const section = region("Unlinked folders");
    expect(within(section).getByText("Receipts 2019")).toBeDefined();
    expect(within(section).getByRole("button", { name: "Ignore Receipts 2019" })).toBeDefined();
    // Only a file waiting for its folder can be linked to.
    expect(within(section).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "A file waiting for its folder",
      "F-0005 · Taxes",
    ]);
  });

  it("keeps Unlinked folders from a member who isn't the admin", async () => {
    given(["use_modules"]);
    render(await PaperworkPage({ searchParams: q }));
    expect(screen.queryByRole("region", { name: "Unlinked folders" })).toBeNull();
  });

  it("doesn't count a folder that's linked, ignored or gone as unlinked", async () => {
    given(ADMIN, { folders: [...FOLDERS.slice(0, 2), { ...FOLDERS[2], ignored: true }] });
    render(await PaperworkPage({ searchParams: q }));
    expect(screen.queryByRole("region", { name: "Unlinked folders" })).toBeNull();
  });

  it("shows them on the Unfiled tab too, apart from the physical desk", async () => {
    given();
    render(await UnfiledPage({ searchParams: q }));
    expect(region("On your desk")).toBeDefined();
    expect(within(region("Unfiled · Google Drive")).getByText("Scan0042.pdf")).toBeDefined();
  });
});

describe("filing a Drive document (REQ-152)", () => {
  it("offers only Drive files that have their folder and are active, and starts from who owns it in Drive", async () => {
    given();
    render(await UnfiledPage({ searchParams: q }));
    fireEvent.click(screen.getByRole("button", { name: "File Scan0042.pdf" }));
    const dialog = await screen.findByRole("dialog", { name: "File Scan0042.pdf" });
    const files = within(dialog).getByLabelText("Google Drive file");
    expect(within(files).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a file", "F-0006 · Taxes — Leases"]);
    expect((within(dialog).getByLabelText("Owner") as HTMLSelectElement).value).toBe("u-alex");
  });

  it("starts at Joint when no member owns it in Drive", async () => {
    given(["use_modules"], { docs: [doc("d-loose", "Scan.pdf", "top")] });
    render(await UnfiledPage({ searchParams: q }));
    fireEvent.click(screen.getByRole("button", { name: "File Scan.pdf" }));
    const dialog = await screen.findByRole("dialog", { name: "File Scan.pdf" });
    expect((within(dialog).getByLabelText("Owner") as HTMLSelectElement).value).toBe("joint");
  });
});

describe("a Drive file's screen (REQ-152)", () => {
  it("waiting for its folder: the exact folder name, a Copy button and I've created it", async () => {
    given();
    render(await openFile("f-5"));
    const waitingCard = region("Waiting for folder");
    expect(within(waitingCard).getByText("Waiting for folder")).toBeDefined();
    expect(within(waitingCard).getByLabelText("Folder name: F-0005_Taxes_2025 Returns")).toBeDefined();
    expect(within(waitingCard).getByRole("button", { name: "Copy" })).toBeDefined();
    expect(within(waitingCard).getByRole("button", { name: "I've created it" })).toBeDefined();
  });

  it("copies the folder name", async () => {
    given();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(await openFile("f-5"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("F-0005_Taxes_2025 Returns"));
  });

  it("lists the documents by their Drive name, each opening in Google Drive", async () => {
    given();
    render(await openFile("f-6"));
    const list = screen.getByRole("list", { name: "Documents in this file" });
    expect(within(list).getByRole("link", { name: "Lease 2025.pdf" }).getAttribute("href")).toBe("https://drive.example/d-set");
    expect(within(list).getByText("Sam")).toBeDefined();
  });

  it("shows Owner not set, with a way to set it, for a document that came in without being filed here", async () => {
    given();
    render(await openFile("f-6"));
    expect(screen.getByText("Owner not set")).toBeDefined();
    expect(screen.getByRole("button", { name: "Set owner: Renewal.pdf" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Set owner: Lease 2025.pdf" })).toBeNull();
  });

  it("marks a document Drive no longer has as Missing; only the admin can remove the record", async () => {
    given();
    render(await openFile("f-6"));
    expect(screen.getByText("Missing in Drive")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remove the record of Old lease.pdf" })).toBeNull();
    cleanup();
    given(ADMIN);
    render(await openFile("f-6"));
    expect(screen.getByRole("button", { name: "Remove the record of Old lease.pdf" })).toBeDefined();
  });

  it("tells the admin when the folder's name doesn't follow the convention, with a Fix", async () => {
    given(ADMIN, { folders: [{ ...FOLDERS[0], name: "Leases (scanned)" }, ...FOLDERS.slice(1)] });
    render(await openFile("f-6"));
    const check = region("Folder name check");
    expect(within(check).getByText("Folder name doesn't follow convention")).toBeDefined();
    expect(within(check).getByText("In Drive it's Leases (scanned); it should be F-0006_Taxes_Leases.")).toBeDefined();
    expect(within(check).getByRole("button", { name: "Fix" })).toBeDefined();
  });

  it("says nothing about a folder name that matches, or to someone who isn't the admin", async () => {
    given(ADMIN);
    render(await openFile("f-6"));
    expect(screen.queryByRole("region", { name: "Folder name check" })).toBeNull();
    cleanup();
    given(["use_modules"], { folders: [{ ...FOLDERS[0], name: "Leases (scanned)" }, ...FOLDERS.slice(1)] });
    render(await openFile("f-6"));
    expect(screen.queryByRole("region", { name: "Folder name check" })).toBeNull();
  });

  it("says its folder is missing once Drive has lost it", async () => {
    given(["use_modules"], { folders: [{ ...FOLDERS[0], missing: true }] });
    render(await openFile("f-6"));
    expect(within(region("Folder missing")).getByText("Folder missing in Drive")).toBeDefined();
  });

  it("is Google Drive · Active, with no label to print and no storage box", async () => {
    given();
    render(await openFile("f-6"));
    fireEvent.click(screen.getByRole("button", { name: /Manage file/ }));
    const menu = screen.getByRole("list", { name: "Manage file" });
    expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Edit category or label",
      "Archive in Google Drive",
      "Remove file",
    ]);
    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Show label to reprint" })).toBeNull();
  });

  it("offers Restore from Archived for an archived file, and nothing to archive while waiting", async () => {
    given();
    render(await openFile("f-7"));
    fireEvent.click(screen.getByRole("button", { name: /Manage file/ }));
    expect(screen.getByRole("button", { name: "Restore from Archived" })).toBeDefined();
    cleanup();
    given();
    render(await openFile("f-5"));
    fireEvent.click(screen.getByRole("button", { name: /Manage file/ }));
    expect(screen.queryByRole("button", { name: /Archive/ })).toBeNull();
  });
});

describe("Google Drive's archive (REQ-153)", () => {
  it("lists archived Drive files and the documents loose in Archived, each of which can come back", async () => {
    given();
    render(await DriveArchivePage({ searchParams: q }));
    expect(within(region("Archived files")).getByText("F-0007 · Taxes")).toBeDefined();
    const loose = region("Archive · Google Drive");
    expect(within(loose).getByRole("link", { name: "Tax 2012.pdf" })).toBeDefined();
    expect(within(loose).getByRole("button", { name: "Restore Tax 2012.pdf" })).toBeDefined();
  });

  it("has nothing to rename, delete, archive or give a category", async () => {
    given(ADMIN);
    render(await DriveArchivePage({ searchParams: q }));
    expect(screen.queryByRole("button", { name: /Manage/ })).toBeNull();
  });

  it("is where an archived Drive file's breadcrumb leads", async () => {
    given();
    render(await openFile("f-7"));
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByRole("link", { name: "Google Drive · Archived" }).getAttribute("href")).toBe("/paperwork/archives/drive");
  });
});

describe("the Google Drive location (REQ-179)", () => {
  it("is built in: no menu to rename or delete it", async () => {
    given();
    render(await LocationPage({ params: Promise.resolve({ id: DRIVE.id }), searchParams: q }));
    expect(screen.queryByRole("button", { name: /Manage location/ })).toBeNull();
    expect(screen.getAllByText(/F-000[56]/).length).toBeGreaterThan(0);
  });

  it("still has its menu for an ordinary location", async () => {
    given();
    render(await LocationPage({ params: Promise.resolve({ id: HALL.id }), searchParams: q }));
    expect(screen.getByRole("button", { name: /Manage location/ })).toBeDefined();
  });
});

describe("making files with Drive as the location (REQ-152)", () => {
  const newFileLocations = async (connection: unknown[]) => {
    given(["use_modules"], { connection });
    render(await PaperworkPage({ searchParams: q }));
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    const dialog = await screen.findByRole("dialog", { name: "New file" });
    return within(within(dialog).getByLabelText("Location")).getAllByRole("option").map((option) => option.textContent);
  };

  it("offers Google Drive once a folder is connected", async () => {
    expect(await newFileLocations([CONNECTION])).toEqual(["Choose a location", "Google Drive", "Hall cupboard", "New location…"]);
  });

  it("doesn't offer it before then", async () => {
    expect(await newFileLocations([])).toEqual(["Choose a location", "Hall cupboard", "New location…"]);
  });

  it("never offers a Drive file to physical paperwork", async () => {
    given();
    render(await PaperworkPage({ searchParams: q }));
    fireEvent.click(screen.getByRole("button", { name: "Log document" }));
    const dialog = await screen.findByRole("dialog", { name: "Log document" });
    const files = within(dialog).getByLabelText("File");
    const names = within(files).getAllByRole("option").map((option) => option.textContent);
    expect(names).toEqual(["Unfiled", "F-0001 · Taxes — Paper returns", "New file…"]);
  });
});

describe("Paperwork settings for Google Drive (REQ-152)", () => {
  it("shows the admin the service account's email and a place to paste one folder link", async () => {
    given(ADMIN, { connection: [] });
    render(await PaperworkSettingsPage({ searchParams: q }));
    const card = region("Google Drive");
    expect(within(card).getByText("robot@example.iam.gserviceaccount.com")).toBeDefined();
    expect(within(card).getByLabelText("Folder link")).toBeDefined();
    expect(within(card).getByText("Not connected.")).toBeDefined();
  });

  it("says it's connected once it is", async () => {
    given(ADMIN);
    render(await PaperworkSettingsPage({ searchParams: q }));
    const card = region("Google Drive");
    expect(within(card).getByRole("link", { name: "this folder" }).getAttribute("href")).toBe("https://drive.google.com/drive/folders/top");
    expect(within(card).getByRole("button", { name: "Check and reconnect" })).toBeDefined();
  });

  it("is for the admin only", async () => {
    given(["use_modules"]);
    render(await PaperworkSettingsPage({ searchParams: q }));
    expect(screen.queryByRole("region", { name: "Google Drive" })).toBeNull();
  });
});
