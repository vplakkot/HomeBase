import { describe, expect, it } from "vitest";
import { MODE_COOKIE, readMode } from "./mode";

function cookiesWith(values: Record<string, string>) {
  return {
    get: (name: string) =>
      name in values ? { value: values[name] } : undefined,
  };
}

describe("readMode", () => {
  it("is member view when no mode cookie is set", () => {
    expect(readMode(cookiesWith({}))).toBe("member");
  });

  it("is admin mode only when the cookie says so", () => {
    expect(readMode(cookiesWith({ [MODE_COOKIE]: "admin" }))).toBe("admin");
  });

  it("treats anything else as member view", () => {
    expect(readMode(cookiesWith({ [MODE_COOKIE]: "root" }))).toBe("member");
    expect(readMode(cookiesWith({ [MODE_COOKIE]: "" }))).toBe("member");
  });
});
