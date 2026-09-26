import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  experimental: {
    // Label photos (REQ-32) are sent with the drink's form: two photos
    // shrunk in the browser to under 450 KB each, plus their small copies,
    // come to about 1 MB. The default limit is 1 MB.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
