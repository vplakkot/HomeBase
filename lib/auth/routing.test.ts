import { describe, expect, it } from "vitest";
import { redirectFor } from "./routing";

describe("redirectFor", () => {
  describe("signed out", () => {
    it.each(["/", "/finances", "/anything/nested", "/sign-in-later"])(
      "sends %s to sign-in",
      (pathname) => {
        expect(redirectFor(pathname, false)).toBe("/sign-in");
      },
    );

    it.each(["/sign-in", "/sign-up", "/sign-up/"])(
      "lets %s through",
      (pathname) => {
        expect(redirectFor(pathname, false)).toBeNull();
      },
    );
  });

  describe("signed in", () => {
    it.each(["/", "/finances", "/anything/nested"])(
      "lets %s through",
      (pathname) => {
        expect(redirectFor(pathname, true)).toBeNull();
      },
    );

    it.each(["/sign-in", "/sign-up", "/set-password"])(
      "sends %s home",
      (pathname) => {
        expect(redirectFor(pathname, true)).toBe("/");
      },
    );
  });

  describe("signed in with a temporary password still in use", () => {
    it.each(["/", "/admin", "/finances", "/sign-in"])(
      "sends %s to set a new password first",
      (pathname) => {
        expect(redirectFor(pathname, true, true)).toBe("/set-password");
      },
    );

    it("lets the set-password page itself through", () => {
      expect(redirectFor("/set-password", true, true)).toBeNull();
    });
  });
});
