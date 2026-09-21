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
  // Standing up a fake browser for files that never touch the DOM was
  // about three quarters of the suite's running time. Flipping this back
  // would slow every run down again without failing anything, which is
  // exactly the kind of regression nobody notices.
  it("leaves files in Node unless they ask for a browser", () => {
    expect(config.test?.environment).toBe("node");
  });

  it("ignores git worktrees, which hold a second copy of the whole repo", () => {
    expect(exclude).toContain("**/.claude/worktrees/**");
  });

  it("excludes only the worktrees, leaving the rest of .claude testable", () => {
    expect(exclude).not.toContain("**/.claude/**");
  });

  // Without it, any test that imports the root layout fails with
  // "Bricolage_Grotesque is not a function".
  it("gives tests a stand-in for next/font, which only works in a Next.js build", () => {
    const alias = config.resolve?.alias as Record<string, string> | undefined;
    expect(alias?.["next/font/google"]).toMatch(/test\/next-font-google\.ts$/);
  });

  it("keeps every default exclude rather than replacing them", () => {
    for (const pattern of configDefaults.exclude) {
      expect(exclude).toContain(pattern);
    }
  });
});
