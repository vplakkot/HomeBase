import { describe, expect, it } from "vitest";
import type { DriveItem } from "./drive";
import { foldersToRead, ownerGuess, planSync, type DriveConnection, type DriveDocument, type DriveFolder } from "./drive-sync";

// An invented Drive: a connected folder with an Archived folder in it.
const CONNECTION: DriveConnection = { folder_id: "top", archived_folder_id: "arch", synced_at: null };
const ALEX = { user_id: "u-alex", google_email: "alex@example.com" };
const SAM = { user_id: "u-sam", google_email: null };

const folder = (id: string, name: string, parent = "top"): DriveItem => ({
  id, name, isFolder: true, parents: [parent], mimeType: "application/vnd.google-apps.folder", link: null, ownerEmail: null,
});
const doc = (id: string, name: string, parent: string, ownerEmail: string | null = null): DriveItem => ({
  id, name, isFolder: false, parents: [parent], mimeType: "application/pdf", link: `https://drive/${id}`, ownerEmail,
});
const knownDoc = (over: Partial<DriveDocument> & { drive_id: string }): DriveDocument => ({
  name: "x", mime_type: null, link: null, drive_owner_email: null, parent_id: "top", owner_id: null, owner_set: false, missing: false, ...over,
});
const knownFolder = (over: Partial<DriveFolder> & { drive_id: string }): DriveFolder => ({
  name: "x", in_archived: false, ignored: false, missing: false, ...over,
});

describe("what a sync reads (REQ-152)", () => {
  it("reads inside a File's folder only once it's linked", () => {
    const items = [folder("f1", "F-0001_Home"), folder("f2", "Stray"), folder("arch", "Archived")];
    expect(foldersToRead(items, CONNECTION, new Set(["f1"]))).toEqual(["f1"]);
  });
});

describe("planSync", () => {
  it("lists sub-folders at the top and in Archived, never the Archived folder itself", () => {
    const plan = planSync(CONNECTION, [folder("arch", "Archived"), folder("f1", "F-0001_Home"), folder("f9", "F-0009_Old", "arch")], [], [], []);
    expect(plan.folders).toEqual([
      { drive_id: "f1", name: "F-0001_Home", in_archived: false, ignored: false, missing: false },
      { drive_id: "f9", name: "F-0009_Old", in_archived: true, ignored: false, missing: false },
    ]);
  });

  it("keeps a folder the admin chose to ignore ignored", () => {
    const plan = planSync(CONNECTION, [folder("f2", "Stray")], [knownFolder({ drive_id: "f2", ignored: true })], [], []);
    expect(plan.folders[0].ignored).toBe(true);
  });

  it("finds documents directly in the top folder, Archived and a File's folder, and ignores deeper ones", () => {
    const items = [
      folder("f1", "F-0001_Home"),
      folder("arch", "Archived"),
      doc("d-top", "Loose.pdf", "top"),
      doc("d-arch", "Old.pdf", "arch"),
      doc("d-file", "Lease.pdf", "f1"),
      doc("d-deep", "Deep.pdf", "some-subfolder"),
    ];
    const plan = planSync(CONNECTION, items, [], [], []);
    expect(plan.documents.map((row) => [row.drive_id, row.parent_id])).toEqual([
      ["d-top", "top"],
      ["d-arch", "arch"],
      ["d-file", "f1"],
    ]);
  });

  it("sets the owner of a document in a File to the member whose Google account owns it", () => {
    const plan = planSync(CONNECTION, [folder("f1", "F-0001_Home"), doc("d1", "Lease.pdf", "f1", "alex@example.com")], [], [], [ALEX, SAM]);
    expect(plan.documents[0]).toMatchObject({ owner_id: "u-alex", owner_set: true });
  });

  it("matches the Google account without regard to case", () => {
    const plan = planSync(CONNECTION, [folder("f1", "F"), doc("d1", "a.pdf", "f1", "alex@example.com")], [], [], [{ user_id: "u-alex", google_email: "Alex@Example.com" }]);
    expect(plan.documents[0].owner_id).toBe("u-alex");
  });

  it("leaves the owner not set when no member matches", () => {
    const plan = planSync(CONNECTION, [folder("f1", "F"), doc("d1", "a.pdf", "f1", "stranger@example.com")], [], [], [ALEX, SAM]);
    expect(plan.documents[0]).toMatchObject({ owner_id: null, owner_set: false });
  });

  it("leaves a loose document in the top folder without an owner; filing confirms it", () => {
    const plan = planSync(CONNECTION, [doc("d1", "a.pdf", "top", "alex@example.com")], [], [], [ALEX]);
    expect(plan.documents[0]).toMatchObject({ owner_id: null, owner_set: false });
  });

  it("never overrides an owner someone already set, even Joint", () => {
    const known = knownDoc({ drive_id: "d1", parent_id: "f1", owner_id: null, owner_set: true });
    const plan = planSync(CONNECTION, [folder("f1", "F"), doc("d1", "a.pdf", "f1", "alex@example.com")], [], [known], [ALEX]);
    expect(plan.documents[0]).toMatchObject({ owner_id: null, owner_set: true });
  });

  it("sets the owner when a loose document is moved into a File's folder by hand", () => {
    const known = knownDoc({ drive_id: "d1", parent_id: "top" });
    const plan = planSync(CONNECTION, [folder("f1", "F"), doc("d1", "a.pdf", "f1", "alex@example.com")], [], [known], [ALEX]);
    expect(plan.documents[0]).toMatchObject({ parent_id: "f1", owner_id: "u-alex", owner_set: true });
  });

  it("marks what Drive no longer has as gone, once", () => {
    const plan = planSync(
      CONNECTION,
      [doc("d1", "kept.pdf", "top")],
      [knownFolder({ drive_id: "gone-folder" }), knownFolder({ drive_id: "already", missing: true })],
      [knownDoc({ drive_id: "d1" }), knownDoc({ drive_id: "gone-doc" }), knownDoc({ drive_id: "already-doc", missing: true })],
      [],
    );
    expect(plan.goneFolders).toEqual(["gone-folder"]);
    expect(plan.goneDocuments).toEqual(["gone-doc"]);
  });

  it("brings back a document or folder that reappears", () => {
    const plan = planSync(CONNECTION, [folder("f1", "F"), doc("d1", "a.pdf", "f1")], [knownFolder({ drive_id: "f1", missing: true })], [knownDoc({ drive_id: "d1", parent_id: "f1", missing: true })], []);
    expect(plan.folders[0].missing).toBe(false);
    expect(plan.documents[0].missing).toBe(false);
  });
});

describe("ownerGuess", () => {
  it("is the member whose Google account owns the document, else nobody", () => {
    expect(ownerGuess("alex@example.com", [ALEX, SAM])).toBe("u-alex");
    expect(ownerGuess("ALEX@example.com", [ALEX])).toBe("u-alex");
    expect(ownerGuess("other@example.com", [ALEX])).toBeNull();
    expect(ownerGuess(null, [ALEX])).toBeNull();
  });
});
