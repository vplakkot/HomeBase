import { createSign } from "node:crypto";

// Google Drive for Paperwork (REQ-152): the little of Drive's REST API the
// app needs, with no Google library. The app signs in as a Google service
// account (a robot with its own email, no password to expire) that the
// household shared one folder with as Editor. The key lives in Vercel as
// GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY, never in git: the Google key file
// either as it is, or base64 of it (easier to paste into Vercel).
//
// What the service account may do was tried against a real Drive folder on
// 2026-10-06 (Notion decision "Drive access test"): move a document, move a
// folder and rename a folder are all allowed.

const API = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type ServiceAccountKey = { client_email: string; private_key: string };

// The key as Vercel holds it: the JSON, or base64 of the JSON. Null when
// it's missing or isn't a service account key.
export function readServiceAccountKey(raw: string | undefined = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY) {
  const text = raw?.trim();
  if (!text) return null;
  const json = text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8");
  try {
    const key = JSON.parse(json) as Partial<ServiceAccountKey>;
    return key.client_email && key.private_key ? { client_email: key.client_email, private_key: key.private_key } : null;
  } catch {
    return null;
  }
}

// Shown to the admin so they know which address to share the folder with.
export const serviceAccountEmail = () => readServiceAccountKey()?.client_email ?? null;

// A pasted Drive link, or the bare folder ID: "…/folders/<id>?…",
// "…/folders/<id>", "…open?id=<id>", or the ID on its own.
export function folderIdFromLink(text: string): string | null {
  const value = text.trim();
  const inPath = value.match(/\/folders\/([\w-]{10,})/)?.[1];
  if (inPath) return inPath;
  const inQuery = value.match(/[?&]id=([\w-]{10,})/)?.[1];
  if (inQuery) return inQuery;
  return /^[\w-]{10,}$/.test(value) ? value : null;
}

export type DriveItem = {
  id: string;
  name: string;
  isFolder: boolean;
  parents: string[];
  mimeType: string;
  link: string | null;
  ownerEmail: string | null;
};

// A failure with a sentence an admin can act on.
export class DriveError extends Error {}

type Token = { value: string; expires: number };
let cached: Token | null = null;

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

async function accessToken(): Promise<string> {
  const key = readServiceAccountKey();
  if (!key) throw new DriveError("Google Drive isn't set up: the service account key is missing.");
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expires - 60 > now) return cached.value;
  const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(key.private_key).toString("base64url");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claims}.${signature}`,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!response.ok || !body.access_token) throw new DriveError("Google didn't accept the service account key.");
  cached = { value: body.access_token, expires: now + (body.expires_in ?? 3600) };
  return cached.value;
}

// Forgets the token (a test, or Google said it's no good).
export function forgetToken() {
  cached = null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) forgetToken();
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    const why = failure.error?.message ?? `status ${response.status}`;
    if (response.status === 404) throw new DriveError("Google Drive can't see that: it was deleted, or isn't shared with HomeBase.");
    throw new DriveError(`Google Drive said no: ${why}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const FIELDS = "id,name,mimeType,parents,webViewLink,owners(emailAddress)";

type RawItem = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  webViewLink?: string;
  owners?: { emailAddress?: string }[];
};

const toItem = (raw: RawItem): DriveItem => ({
  id: raw.id,
  name: raw.name,
  isFolder: raw.mimeType === FOLDER_MIME,
  parents: raw.parents ?? [],
  mimeType: raw.mimeType,
  link: raw.webViewLink ?? null,
  ownerEmail: raw.owners?.[0]?.emailAddress?.toLowerCase() ?? null,
});

// One item, or null when Drive can't find it (deleted, or not shared).
export async function getItem(id: string): Promise<DriveItem | null> {
  try {
    const raw = await call<RawItem & { trashed?: boolean }>("GET", `files/${encodeURIComponent(id)}?fields=${FIELDS},trashed&supportsAllDrives=true`);
    return raw.trashed ? null : toItem(raw);
  } catch (error) {
    if (error instanceof DriveError && error.message.includes("can't see that")) return null;
    throw error;
  }
}

// Everything directly inside any of these folders, not trashed. Asked in
// batches so many folders cost few requests.
export async function listChildren(parentIds: readonly string[]): Promise<DriveItem[]> {
  const found: DriveItem[] = [];
  for (let start = 0; start < parentIds.length; start += 30) {
    const parents = parentIds.slice(start, start + 30);
    const q = `(${parents.map((id) => `'${id}' in parents`).join(" or ")}) and trashed=false`;
    let page: string | undefined;
    do {
      const result = await call<{ files?: RawItem[]; nextPageToken?: string }>(
        "GET",
        `files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(${FIELDS})&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
      );
      found.push(...(result.files ?? []).map(toItem));
      page = result.nextPageToken;
    } while (page);
  }
  return found;
}

// Moves a document or a folder from one folder to another.
export async function moveItem(id: string, from: string, to: string): Promise<void> {
  await call(
    "PATCH",
    `files/${encodeURIComponent(id)}?addParents=${encodeURIComponent(to)}&removeParents=${encodeURIComponent(from)}&fields=id&supportsAllDrives=true`,
    {},
  );
}

export async function renameItem(id: string, name: string): Promise<void> {
  await call("PATCH", `files/${encodeURIComponent(id)}?fields=id&supportsAllDrives=true`, { name });
}

// REQ-152's folder name, "F-0042_Taxes_2025 Returns" (or "F-0042_Taxes"
// with no label name). Drive can't hold "/" in a name, so one is spaced.
export function folderName(fileId: string, category: string, label: string | null): string {
  const tidy = (text: string) => text.replace(/\//g, "-").replace(/\s+/g, " ").trim();
  return label?.trim() ? `${fileId}_${tidy(category)}_${tidy(label)}` : `${fileId}_${tidy(category)}`;
}

// A name with "_" in a category would be cut in the wrong place when a
// folder name is split, so categories can't have one (REQ-152).
export const hasUnderscore = (name: string) => name.includes("_");
