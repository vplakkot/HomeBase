import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // A git worktree under .claude/ is a second checkout of this whole repo,
    // parked on some other commit. Git ignores it; vitest doesn't, so every
    // test gets collected twice and the local count stops matching CI — which
    // is worse than noise, because that stale copy can pass or fail for
    // reasons that have nothing to do with the branch in hand.
    // Spread the defaults rather than replacing them: assigning `exclude`
    // overwrites node_modules, dist and the rest.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
