import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
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
