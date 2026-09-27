import { cookies } from "next/headers";
import { version } from "../package.json";
import { DEVICE_COOKIE } from "./notifications/device";

// What the account menu needs about whoever is signed in: who they are for
// Profile, and for Settings, what this device's notifications control
// needs and which build is running.
export type Account = {
  email: string | null;
  // The name an admin gave the account, if any. The household's first
  // account was made by signing up, which never asked for one.
  name: string | null;
  publicKey?: string;
  // The note this browser keeps once notifications are turned on here.
  knownDevice: string | null;
  build: string;
};

// Which build this is, to tell two apart (REQ-128): the full commit, or
// "local" off Vercel.
export function buildId(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || "local";
}

// The release package.json states, then the branch and short commit
// Vercel built ("v1.0.0 · main · d37b62c"), or "dev · local" in place of
// those two off Vercel. REQ-127: after a refresh, this shows which build
// the phone is now running.
export function buildInfo(): string {
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "dev";
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return `v${version} · ${ref} · ${sha ? sha.slice(0, 7) : "local"}`;
}

export async function readAccount(claims: {
  email?: string;
  user_metadata?: unknown;
}): Promise<Account> {
  const cookieStore = await cookies();
  const name = (claims.user_metadata as { name?: unknown } | undefined)?.name;
  return {
    email: claims.email ?? null,
    name: typeof name === "string" && name.trim() ? name.trim() : null,
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    knownDevice: cookieStore.get(DEVICE_COOKIE)?.value ?? null,
    build: buildInfo(),
  };
}
