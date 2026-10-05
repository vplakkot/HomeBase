import { describe, expect, it } from "vitest";
import { cleanEmail, confirmUrl, EMAIL_INVALID_MESSAGE, EMAIL_TAKEN_MESSAGE, emailErrorMessage, usedByAnother } from "./email";

describe("cleanEmail", () => {
  it("trims and lower-cases", () => {
    expect(cleanEmail("  Megan@Example.COM ")).toBe("megan@example.com");
  });
  it.each(["", "megan", "megan@", "@example.com", "megan@example", "me gan@example.com", 5, null])(
    "refuses %j",
    (typed) => expect(cleanEmail(typed)).toBeNull(),
  );
});

describe("usedByAnother", () => {
  const members = [
    { user_id: "u1", email: "Vin@example.com" },
    { user_id: "u2", email: "megan@example.com" },
  ];
  it("sees another member's address, in any case", () => {
    expect(usedByAnother(members, "vin@example.com", "u2")).toBe(true);
  });
  it("lets a person keep or retype their own", () => {
    expect(usedByAnother(members, "megan@example.com", "u2")).toBe(false);
  });
  it("lets a new address through", () => {
    expect(usedByAnother(members, "new@example.com", "u2")).toBe(false);
  });
});

describe("confirmUrl", () => {
  it("is this app's own /auth/confirm on whatever address is in use", () => {
    expect(confirmUrl("home-base-peach.vercel.app")).toBe("https://home-base-peach.vercel.app/auth/confirm");
    expect(confirmUrl("localhost:3000")).toBe("http://localhost:3000/auth/confirm");
    expect(confirmUrl(null)).toBeUndefined();
  });
});

describe("emailErrorMessage", () => {
  it("names a taken address, a rate limit, and anything else plainly", () => {
    expect(emailErrorMessage({ code: "email_exists", message: "x" })).toBe(EMAIL_TAKEN_MESSAGE);
    expect(emailErrorMessage({ message: "A user with this email address has already been registered" })).toBe(EMAIL_TAKEN_MESSAGE);
    expect(emailErrorMessage({ code: "over_email_send_rate_limit", message: "x" })).toMatch(/Too many emails/);
    expect(emailErrorMessage({ code: "email_address_invalid", message: "x" })).toBe(EMAIL_INVALID_MESSAGE);
    expect(emailErrorMessage({ message: "SMTP exploded at 10.0.0.1" })).toBe("Couldn't send the email. Try again in a moment.");
  });
});
