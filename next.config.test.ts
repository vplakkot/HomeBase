import { describe, expect, it, vi } from "vitest";

// next.config.ts pulls in Sentry; the redirect list is all this checks.
vi.mock("@sentry/nextjs/config", () => ({ withSentryConfig: (config: unknown) => config }));

describe("next.config redirects", () => {
  it("sends the old /paperwork/files/<id> link to the File Folder screen (REQ-205)", async () => {
    const { default: config } = (await import("./next.config")) as { default: { redirects: () => Promise<unknown[]> } };
    expect(await config.redirects()).toContainEqual({
      source: "/paperwork/files/:id",
      destination: "/paperwork/file-folders/:id",
      permanent: true,
    });
  });
});
