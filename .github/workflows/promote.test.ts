import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The promote workflow only fires on tags shaped like vX.Y.Z (see
// docs/lessons/03-tags-releases-promote.md, "Tightening the trigger").
// GitHub Actions' tag-filter glob and JS regex agree on "[0-9]+"
// (character class + quantifier), but GitHub treats "." as a literal
// character where JS regex treats it as "any character" - so the only
// translation needed is escaping the dots before matching real strings
// against it.

function readTagPattern(): string {
  const workflow = readFileSync(join(__dirname, "promote.yml"), "utf-8");
  const match = workflow.match(/tags:\s*\n\s*-\s*"([^"]+)"/);
  if (!match) {
    throw new Error("Could not find the tag trigger pattern in promote.yml");
  }
  return match[1];
}

function toRegExp(githubTagGlob: string): RegExp {
  return new RegExp(`^${githubTagGlob.replace(/\./g, "\\.")}$`);
}

describe("promote.yml tag trigger", () => {
  it("is the strict major.minor.patch pattern", () => {
    expect(readTagPattern()).toBe("v[0-9]+.[0-9]+.[0-9]+");
  });

  const pattern = toRegExp(readTagPattern());

  it.each(["v0.0.5", "v1.2.3", "v10.20.30"])(
    "matches a real version tag: %s",
    (tag) => {
      expect(pattern.test(tag)).toBe(true);
    },
  );

  it.each(["v.0.0.1", "v1.0.0-beta", "vfoo", "v0.0", "v0.0.0.0", "0.0.5"])(
    "rejects a malformed tag: %s",
    (tag) => {
      expect(pattern.test(tag)).toBe(false);
    },
  );
});

// The workflow used to promote whatever Vercel considered the "latest"
// production-target build, which is wrong once main has moved on past the
// tagged commit by the time the tag is pushed (see docs/lessons/03-tags-
// releases-promote.md, "The promote step must target the tagged commit").
// It now filters candidate deployments down to the one whose commit SHA
// matches the commit the tag points to, and fails loudly instead of
// silently falling back to an unrelated deployment.
describe("promote.yml deployment lookup", () => {
  const workflow = readFileSync(join(__dirname, "promote.yml"), "utf-8");

  it("filters deployments by the tagged commit's SHA", () => {
    expect(workflow).toContain("githubCommitSha");
    expect(workflow).toContain("$GITHUB_SHA");
  });

  it("does not just take the first/latest deployment unfiltered", () => {
    expect(workflow).not.toContain(".deployments[0].url");
  });

  it("fails the job instead of promoting a fallback when no match is found", () => {
    expect(workflow).toMatch(/if \[ -z "\$url" \]/);
    expect(workflow).toContain("exit 1");
  });
});
