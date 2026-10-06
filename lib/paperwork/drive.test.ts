import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DriveError,
  FOLDER_MIME,
  folderIdFromLink,
  folderName,
  forgetToken,
  getItem,
  hasUnderscore,
  listChildren,
  moveItem,
  readServiceAccountKey,
  renameItem,
  serviceAccountEmail,
} from "./drive";

// An invented robot account with a freshly made key; nothing here is real.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY = { client_email: "robot@example.iam.gserviceaccount.com", private_key: privateKey, type: "service_account" };
const RAW = JSON.stringify(KEY);
const BASE64 = Buffer.from(RAW).toString("base64");

describe("the Google Drive key (REQ-152)", () => {
  it("is read as the Google key file, or as base64 of it", () => {
    expect(readServiceAccountKey(RAW)?.client_email).toBe(KEY.client_email);
    expect(readServiceAccountKey(BASE64)?.client_email).toBe(KEY.client_email);
    expect(readServiceAccountKey(`  ${BASE64}\n`)?.client_email).toBe(KEY.client_email);
  });

  it("is nothing when missing or not a service account key", () => {
    expect(readServiceAccountKey("")).toBeNull();
    expect(readServiceAccountKey(undefined)).toBeNull();
    expect(readServiceAccountKey("not a key")).toBeNull();
    expect(readServiceAccountKey(JSON.stringify({ client_email: "a@b.c" }))).toBeNull();
  });

  it("shows the admin which address to share the folder with", () => {
    vi.stubEnv("GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY", BASE64);
    expect(serviceAccountEmail()).toBe(KEY.client_email);
    vi.stubEnv("GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY", "");
    expect(serviceAccountEmail()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("a pasted folder link", () => {
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456";
  it("gives the folder's ID from any of the usual forms", () => {
    expect(folderIdFromLink(`https://drive.google.com/drive/u/1/folders/${ID}`)).toBe(ID);
    expect(folderIdFromLink(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID);
    expect(folderIdFromLink(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
    expect(folderIdFromLink(`  ${ID} `)).toBe(ID);
  });

  it("is nothing for something that isn't a folder link", () => {
    expect(folderIdFromLink("")).toBeNull();
    expect(folderIdFromLink("https://example.com/hello world")).toBeNull();
  });
});

describe("folder names (REQ-152)", () => {
  it("are <ID>_<Category>_<label name>, or <ID>_<Category> with no label", () => {
    expect(folderName("F-0042", "Taxes", "2025 Returns")).toBe("F-0042_Taxes_2025 Returns");
    expect(folderName("F-0042", "Taxes", null)).toBe("F-0042_Taxes");
    expect(folderName("F-0042", "Taxes", "  ")).toBe("F-0042_Taxes");
  });

  it("can't carry a slash, which Drive names don't allow", () => {
    expect(folderName("F-0001", "Home", "Deeds / titles")).toBe("F-0001_Home_Deeds - titles");
  });

  it("can't have an underscore in a category", () => {
    expect(hasUnderscore("Car_loans")).toBe(true);
    expect(hasUnderscore("Car loans")).toBe(false);
  });
});

describe("talking to Drive", () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const reply = vi.fn<(url: string) => { status?: number; body: unknown }>();

  beforeEach(() => {
    forgetToken();
    calls.length = 0;
    vi.stubEnv("GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY", BASE64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.startsWith("https://oauth2.googleapis.com/token")) {
          return Response.json({ access_token: "token-1", expires_in: 3600 });
        }
        const { status = 200, body } = reply(url);
        return Response.json(body, { status });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    reply.mockReset();
  });

  const driveCalls = () => calls.filter((call) => call.url.startsWith("https://www.googleapis.com/drive/v3/"));

  it("signs in once with a signed request and reuses the token", async () => {
    reply.mockReturnValue({ body: { files: [] } });
    await listChildren(["a-folder-id-1"]);
    await listChildren(["a-folder-id-1"]);
    const tokens = calls.filter((call) => call.url.startsWith("https://oauth2.googleapis.com/token"));
    expect(tokens).toHaveLength(1);
    const assertion = new URLSearchParams(String(tokens[0].init?.body)).get("assertion") ?? "";
    expect(assertion.split(".")).toHaveLength(3);
    expect(driveCalls()[0].init?.headers).toMatchObject({ authorization: "Bearer token-1" });
  });

  it("says so when the key is missing", async () => {
    vi.stubEnv("GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY", "");
    await expect(listChildren(["a-folder-id-1"])).rejects.toBeInstanceOf(DriveError);
  });

  it("lists what's directly inside folders, folders and documents apart, with the owner", async () => {
    reply.mockReturnValue({
      body: {
        files: [
          { id: "d1", name: "Lease.pdf", mimeType: "application/pdf", parents: ["top"], webViewLink: "https://drive/d1", owners: [{ emailAddress: "Alex@Example.com" }] },
          { id: "f1", name: "F-0001_Home", mimeType: FOLDER_MIME, parents: ["top"] },
        ],
      },
    });
    const items = await listChildren(["top"]);
    expect(items).toEqual([
      { id: "d1", name: "Lease.pdf", isFolder: false, parents: ["top"], mimeType: "application/pdf", link: "https://drive/d1", ownerEmail: "alex@example.com" },
      { id: "f1", name: "F-0001_Home", isFolder: true, parents: ["top"], mimeType: FOLDER_MIME, link: null, ownerEmail: null },
    ]);
    const query = new URL(driveCalls()[0].url).searchParams.get("q");
    expect(query).toBe("('top' in parents) and trashed=false");
  });

  it("asks about many folders in batches, and follows pages", async () => {
    const ids = Array.from({ length: 65 }, (_, index) => `folder-${index}`);
    reply.mockImplementation((url) => {
      const token = new URL(url).searchParams.get("pageToken");
      return { body: { files: [], nextPageToken: token ? undefined : "more" } };
    });
    await listChildren(ids);
    // 65 folders is 3 batches of at most 30; each has a second page.
    expect(driveCalls()).toHaveLength(6);
  });

  it("moves a document or folder by swapping its parent", async () => {
    reply.mockReturnValue({ body: { id: "x" } });
    await moveItem("doc-1", "from-1", "to-1");
    const url = new URL(driveCalls()[0].url);
    expect(driveCalls()[0].init?.method).toBe("PATCH");
    expect(url.pathname).toBe("/drive/v3/files/doc-1");
    expect(url.searchParams.get("addParents")).toBe("to-1");
    expect(url.searchParams.get("removeParents")).toBe("from-1");
  });

  it("renames by sending the new name", async () => {
    reply.mockReturnValue({ body: { id: "x" } });
    await renameItem("folder-1", "F-0001_Home");
    expect(driveCalls()[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(driveCalls()[0].init?.body))).toEqual({ name: "F-0001_Home" });
  });

  it("reads an item, and finds nothing for one that's gone, trashed or not shared", async () => {
    reply.mockReturnValueOnce({ body: { id: "a", name: "A", mimeType: FOLDER_MIME } });
    expect((await getItem("a"))?.isFolder).toBe(true);
    reply.mockReturnValueOnce({ body: { id: "a", name: "A", mimeType: FOLDER_MIME, trashed: true } });
    expect(await getItem("a")).toBeNull();
    reply.mockReturnValueOnce({ status: 404, body: { error: { message: "File not found" } } });
    expect(await getItem("a")).toBeNull();
  });

  it("explains a refusal in words, not a status", async () => {
    reply.mockReturnValue({ status: 403, body: { error: { message: "The user does not have sufficient permissions" } } });
    await expect(moveItem("a", "b", "c")).rejects.toThrow(/Google Drive said no/);
  });
});
