import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // next/font only works inside a Next.js build, which rewrites each
      // font call; the package itself is empty. Anything importing the root
      // layout loads the fonts, so tests get a stand-in with the same shape.
      "next/font/google": fileURLToPath(
        new URL("./test/next-font-google.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Most test files here never touch the DOM: they exercise server
    // actions, library functions, SQL and workflow files. Standing up a
    // fake browser for those was about three quarters of the suite's
    // running time. The handful that need a browser ask for one, with a
    // `// @vitest-environment jsdom` line as the first line of the file.
    //
    // If you are here because a new test failed with `ReferenceError:
    // document is not defined`, or `window`, or `navigator`, that line is
    // what it wants. Any file that renders a component, or that leans on
    // something a browser provides, needs it.
    environment: "node",
    // A git worktree is a second checkout of this whole repo, parked on
    // another commit. Vitest doesn't read .gitignore, so it collected every
    // test twice and the local count stopped matching CI — worse than noise,
    // because that stale copy can pass or fail for reasons belonging to a
    // branch nobody is touching.
    // Only the worktrees directory is excluded, not all of .claude: the rest
    // of it is tracked, and .github/workflows/*.test.ts already shows this
    // repo happily testing config that lives in a dot-directory.
    // Spread the defaults rather than assigning: assigning replaces them, and
    // node_modules is in there.
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
  },
});
