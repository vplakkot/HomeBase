import { describe, expect, it } from "vitest";
import { cleanName, NAME_MAX } from "./names";

describe("a display name (REQ-124)", () => {
  it("keeps a name, without spaces round it or runs of spaces inside", () => {
    expect(cleanName("  Sam   Lee ")).toBe("Sam Lee");
  });

  it("isn't saved empty, blank, too long, or missing", () => {
    expect(cleanName("")).toBeNull();
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(NAME_MAX + 1))).toBeNull();
    expect(cleanName(null)).toBeNull();
    expect(cleanName("x".repeat(NAME_MAX))).toHaveLength(NAME_MAX);
  });
});
