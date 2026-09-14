function getBuildInfo() {
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "dev";
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const commit = sha ? sha.slice(0, 7) : "local";
  return `${ref} · ${commit}`;
}

export default function HomePage() {
  return (
    <>
      <h1>HomeBase</h1>
      <p
        data-testid="build-info"
        style={{ fontSize: "0.75rem", color: "#888", marginTop: "3rem" }}
      >
        {getBuildInfo()}
      </p>
    </>
  );
}
