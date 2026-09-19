import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import config from "./vitest.config";

// Two ways this regresses, and neither announces itself: the worktree exclude
// gets dropped, or someone assigns `exclude` a fresh array and loses
// node_modules with it. Both surface only as a test count nobody reads
// closely. These assert the declared config, so they catch a line being
// deleted or overwritten; they can't prove the glob matches, which would
// need a globbing dependency this project hasn't taken on.
const exclude = config.test?.exclude ?? [];

describe("vitest config", () => {
  it("ignores git worktrees, which hold a second copy of the whole repo", () => {
    expect(exclude).toContain("**/.claude/worktrees/**");
  });

  it("excludes only the worktrees, leaving the rest of .claude testable", () => {
    expect(exclude).not.toContain("**/.claude/**");
  });

  it("keeps every default exclude rather than replacing them", () => {
    for (const pattern of configDefaults.exclude) {
      expect(exclude).toContain(pattern);
    }
  });
});
