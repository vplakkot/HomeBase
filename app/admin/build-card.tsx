"use client";

import { useEffect, useState } from "react";
import { commitUrl, environmentLabel, releaseTagFor, runningBuild, shortSha } from "../../lib/build-info";
import styles from "./page.module.css";

// REQ-123: which release and commit this installed app is running, to tell
// two installed copies apart. Read from the app's own code, not from the
// server, so it says the build that was loaded, even when a newer one has
// since been deployed (the "New version ready" note says that).
export function BuildCard() {
  const build = runningBuild();
  // undefined: still asking GitHub; null: untagged; false: couldn't check.
  const [tag, setTag] = useState<string | null | false | undefined>(undefined);
  const [builtAt, setBuiltAt] = useState<string>("");

  useEffect(() => {
    setBuiltAt(build.builtAt ? new Date(build.builtAt).toLocaleString() : "");
    if (!build.sha) {
      setTag(null);
      return;
    }
    let current = true;
    releaseTagFor(build.version, build.sha).then(
      (found) => current && setTag(found),
      () => current && setTag(false),
    );
    return () => {
      current = false;
    };
  }, [build.builtAt, build.sha, build.version]);

  const tagText = tag === undefined ? "Checking…" : tag === false ? "Couldn't check" : (tag ?? "untagged");
  return (
    <dl data-testid="admin-build" className={styles.build} aria-label="This installed app">
      <div>
        <dt>Release</dt>
        <dd>{tagText}</dd>
      </div>
      <div>
        <dt>Commit</dt>
        <dd>
          {build.sha ? (
            <a href={commitUrl(build.sha)} target="_blank" rel="noreferrer">
              {shortSha(build.sha)}
            </a>
          ) : (
            "local"
          )}
        </dd>
      </div>
      <div>
        <dt>Environment</dt>
        <dd>{environmentLabel(build)}</dd>
      </div>
      <div>
        <dt>Built</dt>
        <dd>{builtAt || "—"}</dd>
      </div>
    </dl>
  );
}
