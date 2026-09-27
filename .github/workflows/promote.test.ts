import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("does not fall back to another commit's build", () => {
    const run = runLookup([
      { deployments: [build("other", "READY", "someothersha")] },
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.url).toBe("");
    expect(run.output).toContain("No production build found");
  });
});

// A tag pushed seconds after its merge can arrive while Vercel is still
// building that commit (the v2.0.0 release hit a 422 "not ready"; see
// docs/lessons/03-tags-releases-promote.md, "Pushing the tag too soon").
// These run the lookup step's real script from promote.yml, with curl
// swapped for a stand-in that plays back made-up Vercel answers, one per
// call. The wait is shortened so a timeout takes seconds, not 10 minutes.

const SHA = "abc123";

type Answer = object | string; // "FAIL" makes the fake curl fail

function build(url: string, readyState: string, sha = SHA) {
  return { url, readyState, meta: { githubCommitSha: sha } };
}

function lookupScript(): string {
  const workflow = readFileSync(join(__dirname, "promote.yml"), "utf-8");
  const step = workflow
    .split("\n      - name: ")
    .find((s) => s.includes("id: find"));
  if (!step) throw new Error("Could not find the lookup step in promote.yml");
  const body = step.split("run: |\n")[1];
  return body
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .replaceAll("${{ github.ref_name }}", "v9.9.9")
    .replace("sleep 15", "sleep 0")
    .replace("SECONDS + 600", "SECONDS + 3");
}

function runLookup(answers: Answer[]) {
  const dir = mkdtempSync(join(tmpdir(), "promote-"));
  answers.forEach((a, i) =>
    writeFileSync(
      join(dir, `answer_${i + 1}`),
      typeof a === "string" ? a : JSON.stringify(a),
    ),
  );
  writeFileSync(join(dir, "count"), "0");
  writeFileSync(join(dir, "out"), "");
  const fakeCurl = `
curl() {
  local n=$(( $(cat "$DIR/count") + 1 )); echo "$n" > "$DIR/count"
  local f="$DIR/answer_$n"; [ -f "$f" ] || f="$DIR/answer_${answers.length}"
  [ "$(cat "$f")" = FAIL ] && return 6
  cat "$f"
}
`;
  let output = "";
  let exitCode = 0;
  try {
    output = execFileSync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-eo",
        "pipefail",
        "-c",
        fakeCurl + lookupScript(),
      ],
      {
        env: {
          ...process.env,
          DIR: dir,
          GITHUB_SHA: SHA,
          GITHUB_OUTPUT: join(dir, "out"),
        },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    exitCode = err.status;
    output = err.stdout + err.stderr;
  }
  const url =
    readFileSync(join(dir, "out"), "utf-8").match(/^url=(.*)$/m)?.[1] ?? "";
  return { exitCode, url, output };
}

describe("promote.yml waits for the tagged commit's build", () => {
  it("waits while the build is not listed, then building, and promotes once ready", () => {
    const run = runLookup([
      { deployments: [] },
      {
        deployments: [
          build("wip", "BUILDING"),
          build("old", "READY", "someothersha"),
        ],
      },
      { deployments: [build("wip", "READY")] },
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.url).toBe("wip");
    expect(run.output).toContain("is BUILDING; checking again");
  });

  it("stops at once when the build failed", () => {
    const run = runLookup([{ deployments: [build("bad", "ERROR")] }]);
    expect(run.exitCode).toBe(1);
    expect(run.url).toBe("");
    expect(run.output).toContain("ended in ERROR");
  });

  it("gives up after the wait if the build never finishes", () => {
    const run = runLookup([{ deployments: [build("slow", "BUILDING")] }]);
    expect(run.exitCode).toBe(1);
    expect(run.url).toBe("");
    expect(run.output).toContain("still BUILDING");
  });

  it.each<[string, Answer]>([
    ["a failed request", "FAIL"],
    ["an HTML error page", "<html>502 Bad Gateway</html>"],
    ["a JSON error", { error: { message: "rate limited" } }],
  ])("retries after %s", (_, bad) => {
    const run = runLookup([bad, { deployments: [build("ok", "READY")] }]);
    expect(run.exitCode).toBe(0);
    expect(run.url).toBe("ok");
  });

  it("uses a ready build of the commit even if a newer redeploy failed", () => {
    const run = runLookup([
      { deployments: [build("redeploy", "ERROR"), build("first", "BUILDING")] },
      { deployments: [build("redeploy", "ERROR"), build("first", "READY")] },
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.url).toBe("first");
  });

  it("stops only when every build of the commit failed or was cancelled", () => {
    const run = runLookup([
      { deployments: [build("redeploy", "CANCELED"), build("first", "ERROR")] },
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("ended in CANCELED");
  });
});
