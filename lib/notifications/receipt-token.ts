import { createHash, randomBytes } from "node:crypto";

// REQ-22. The secret a device quotes back to say a notification arrived.
//
// What goes to the phone is the token. What goes in the log is a hash of
// it, for the same reason a password is never stored as typed: an admin
// can read the log, and a stored token would let them forge a delivery
// that never happened. A hash proves a token without being one.
//
// A plain SHA-256 is enough here, unlike a password. Passwords need slow,
// salted hashing because people choose guessable ones; this is 256 random
// bits, so there is no shorter route than trying them all.

export function newReceiptToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashReceiptToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Long enough to be worth a lookup, short enough to reject junk cheaply.
// Also excludes every character PostgREST reads as filter syntax.
const LOOKS_LIKE_A_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function looksLikeAToken(value: unknown): value is string {
  return typeof value === "string" && LOOKS_LIKE_A_TOKEN.test(value);
}
