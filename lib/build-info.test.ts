import { afterEach, describe, expect, it, vi } from "vitest";
import { commitUrl, environmentLabel, releaseTagFor, runningBuild, shortSha } from "./build-info";

const SHA = "93739b472d15908e13dacbc97303b84a8288d0a5";
const answer = (body: unknown, ok = true, status = 200) => vi.fn(async () => ({ ok, status, json: async () => body }) as Response);

afterEach(() => vi.unstubAllEnvs());

describe("what the running build says about itself (REQ-123)", () => {
  it("reads the values written into the app when it was built", () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_VERSION", "3.0.0");
    vi.stubEnv("NEXT_PUBLIC_BUILD_SHA", SHA);
    vi.stubEnv("NEXT_PUBLIC_BUILD_REF", "main");
    vi.stubEnv("NEXT_PUBLIC_BUILD_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "2026-10-04T17:00:00.000Z");
    expect(runningBuild()).toEqual({ version: "3.0.0", sha: SHA, ref: "main", env: "production", builtAt: "2026-10-04T17:00:00.000Z" });
  });

  it("names the environment: Production, the branch of a preview, or Local", () => {
    expect(environmentLabel({ env: "production", ref: "main" })).toBe("Production");
    expect(environmentLabel({ env: "preview", ref: "my-branch" })).toBe("Preview · my-branch");
    expect(environmentLabel({ env: "preview", ref: "" })).toBe("Preview");
    expect(environmentLabel({ env: "", ref: "" })).toBe("Local");
  });

  it("links the short commit to GitHub", () => {
    expect(shortSha(SHA)).toBe("93739b4");
    expect(commitUrl(SHA)).toBe(`https://github.com/vplakkot/HomeBase/commit/${SHA}`);
  });
});

describe("the release tag of a commit (REQ-123)", () => {
  const ref = (type: string, sha = SHA) => [{ ref: "refs/tags/v3.0.0", object: { sha, type, url: "https://api.github.com/tag" } }];

  it("is the tag its version names, when that tag points at this very commit", async () => {
    expect(await releaseTagFor("3.0.0", SHA, answer(ref("commit")))).toBe("v3.0.0");
  });

  it("is untagged when the tag points at another commit, or doesn't exist", async () => {
    expect(await releaseTagFor("3.0.0", "f".repeat(40), answer(ref("commit")))).toBeNull();
    expect(await releaseTagFor("3.0.1", SHA, answer([]))).toBeNull();
    // matching-refs is a prefix search: v3.0.0 also finds v3.0.01 and the like.
    expect(await releaseTagFor("3.0.0", SHA, answer([{ ref: "refs/tags/v3.0.00", object: { sha: SHA, type: "commit" } }]))).toBeNull();
  });

  it("follows an annotated tag to its commit", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ref("tag", "t".repeat(40)) }).mockResolvedValueOnce({ ok: true, json: async () => ({ object: { sha: SHA } }) });
    expect(await releaseTagFor("3.0.0", SHA, get as unknown as typeof fetch)).toBe("v3.0.0");
  });

  it("throws, rather than say untagged, when GitHub can't be asked", async () => {
    await expect(releaseTagFor("3.0.0", SHA, answer({}, false, 403))).rejects.toThrow("403");
    await expect(releaseTagFor("3.0.0", SHA, vi.fn().mockRejectedValue(new Error("offline")))).rejects.toThrow("offline");
  });
});
