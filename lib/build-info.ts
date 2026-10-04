// REQ-123: what the admin console says about the build an installed app is
// running. The values are written into the app's code when it is built
// (next.config.ts), so they are the app's own, whatever has been deployed
// since. Nothing here reads the server.

export const REPO = "vplakkot/HomeBase";

export type RunningBuild = {
  version: string;
  sha: string;
  ref: string;
  env: string;
  builtAt: string;
};

export function runningBuild(): RunningBuild {
  return {
    version: process.env.NEXT_PUBLIC_BUILD_VERSION ?? "",
    sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? "",
    ref: process.env.NEXT_PUBLIC_BUILD_REF ?? "",
    env: process.env.NEXT_PUBLIC_BUILD_ENV ?? "",
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? "",
  };
}

// "Production", "Preview · my-branch", or "Local" off Vercel.
export function environmentLabel(build: Pick<RunningBuild, "env" | "ref">): string {
  if (build.env === "production") return "Production";
  if (build.env === "preview") return build.ref ? `Preview · ${build.ref}` : "Preview";
  return "Local";
}

export const shortSha = (sha: string) => sha.slice(0, 7);

export const commitUrl = (sha: string) => `https://github.com/${REPO}/commit/${sha}`;

// The release tag a commit carries, or null when it has none. A release is
// tagged after its commit is built (the tag is pushed once the version bump
// has merged), so the build can't know its own tag; GitHub is asked. The
// tag a build might carry is the one its own version names. Throws when
// GitHub can't be reached or answers oddly, which is not the same as "no
// tag", so the caller can say "couldn't check" rather than "untagged".
export async function releaseTagFor(
  version: string,
  sha: string,
  get: typeof fetch = fetch,
): Promise<string | null> {
  const tag = `v${version}`;
  const reply = await get(`https://api.github.com/repos/${REPO}/git/matching-refs/tags/${tag}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!reply.ok) throw new Error(`GitHub answered ${reply.status}`);
  const refs = (await reply.json()) as { ref?: string; object?: { sha?: string; type?: string; url?: string } }[];
  const found = refs.find((ref) => ref.ref === `refs/tags/${tag}`);
  if (!found?.object) return null;
  let target = found.object.sha;
  // An annotated tag points at a tag object, which points at the commit.
  if (found.object.type === "tag" && found.object.url) {
    const inner = await get(found.object.url, { headers: { Accept: "application/vnd.github+json" } });
    if (!inner.ok) throw new Error(`GitHub answered ${inner.status}`);
    target = ((await inner.json()) as { object?: { sha?: string } }).object?.sha;
  }
  return target === sha ? tag : null;
}
