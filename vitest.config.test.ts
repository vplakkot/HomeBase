import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import config from "./vitest.config";

// Two ways this can regress, and neither announces itself: the exclude for
// worktrees gets dropped, or someone assigns `exclude` a fresh array and
// silently loses node_modules along with it. Both show up only as a test
// count nobody reads closely.
const exclude = config.test?.exclude ?? [];

describe("vitest config", () => {
  it("ignores git worktrees, which hold a second copy of the whole repo", () => {
    expect(exclude).toContain("**/.claude/**");
  });

  it("keeps every default exclude rather than replacing them", () => {
    for (const pattern of configDefaults.exclude) {
      expect(exclude).toContain(pattern);
    }
  });

  it("still runs the app's tests in a browser-like environment", () => {
    expect(config.test?.environment).toBe("jsdom");
  });
});
