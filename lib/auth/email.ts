import type { Member } from "./members";

// REQ-158: an email address as typed. Trimmed and lower-cased, since the
// household's addresses are compared without regard to case; anything that
// isn't plainly name@place.tld is not an address.
export function cleanEmail(typed: unknown): string | null {
  if (typeof typed !== "string") return null;
  const email = typed.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Whether another member already uses this address. Everyone with an
// account is a member, so the household's own list is the whole list.
export function usedByAnother(members: Pick<Member, "user_id" | "email">[], email: string, userId: string): boolean {
  return members.some((member) => member.user_id !== userId && member.email.toLowerCase() === email);
}

export const EMAIL_TAKEN_MESSAGE = "That address already belongs to another account in this household.";
export const EMAIL_INVALID_MESSAGE = "Type a full email address, like name@example.com.";

// Where the link in an auth email lands: this app's own /auth/confirm, on
// whichever address the person is using (production, the main preview, or
// this laptop). Supabase fills it into the email template as
// {{ .RedirectTo }}, and only sends people to addresses on its list.
export function confirmUrl(host: string | null): string | undefined {
  if (!host) return undefined;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}/auth/confirm`;
}

// What a change of email reports back. "confirm": a confirmation went to the
// new address and nothing changes until it's followed. "invite": the person
// had never signed in, so the new address got a link to choose a password.
export type EmailChangeState = {
  error?: string;
  sent?: { address: string; kind: "confirm" | "invite" };
};

// Supabase's refusals, in words a person can act on. The raw message goes to
// the server log, not the screen.
export function emailErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "email_exists" || /already (been )?registered|already exists/i.test(error.message)) {
    return EMAIL_TAKEN_MESSAGE;
  }
  if (error.code === "over_email_send_rate_limit" || /rate limit/i.test(error.message)) {
    return "Too many emails were sent just now. Try again in a few minutes.";
  }
  if (error.code === "email_address_invalid") return EMAIL_INVALID_MESSAGE;
  return "Couldn't send the email. Try again in a moment.";
}
