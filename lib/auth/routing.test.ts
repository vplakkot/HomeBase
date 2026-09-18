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

    it.each(["/sign-in", "/sign-up"])("sends %s home", (pathname) => {
      expect(redirectFor(pathname, true)).toBe("/");
    });
  });
});
