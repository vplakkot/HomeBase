import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  // REQ-123: which build an installed app is running. These are written
  // into the app's own code when it is built, so an app loaded last week
  // still says last week's build after a newer one is deployed; a value
  // read on the server at request time would say the newest.
  env: {
    NEXT_PUBLIC_BUILD_VERSION: version,
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    NEXT_PUBLIC_BUILD_REF: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    NEXT_PUBLIC_BUILD_ENV: process.env.VERCEL_ENV ?? "",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  experimental: {
    // Label photos (REQ-32) are sent with the drink's form: two photos
    // shrunk in the browser to under 450 KB each, plus their small copies,
    // come to about 1 MB. The default limit is 1 MB. A recipe from images
    // (REQ-157) sends up to 3 shrunk pictures and their small copies, kept
    // under 2.5 MB by the action, below Vercel's own limit of about 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
