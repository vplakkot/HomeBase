// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildCard } from "./build-card";

const SHA = "93739b472d15908e13dacbc97303b84a8288d0a5";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function built(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(`NEXT_PUBLIC_BUILD_${key}`, value);
}

function github(reply: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(reply));
}

describe("the build card (REQ-123)", () => {
  it("shows the release tag, the commit linked to GitHub, the environment and when it was built", async () => {
    built({ VERSION: "3.0.0", SHA, REF: "main", ENV: "production", TIME: "2026-10-04T17:00:00.000Z" });
    github(async () => ({ ok: true, json: async () => [{ ref: "refs/tags/v3.0.0", object: { sha: SHA, type: "commit" } }] }));
    render(<BuildCard />);
    const card = within(screen.getByTestId("admin-build"));
    await waitFor(() => expect(card.getByText("Release").nextElementSibling?.textContent).toBe("v3.0.0"));
    expect(card.getByRole("link", { name: "93739b4" }).getAttribute("href")).toBe(`https://github.com/vplakkot/HomeBase/commit/${SHA}`);
    expect(card.getByText("Environment").nextElementSibling?.textContent).toBe("Production");
    expect(card.getByText("Built").nextElementSibling?.textContent).not.toBe("—");
  });

  it("says untagged for a commit without a release, and names a preview by its branch", async () => {
    built({ VERSION: "3.0.0", SHA: "f".repeat(40), REF: "my-branch", ENV: "preview", TIME: "2026-10-04T17:00:00.000Z" });
    github(async () => ({ ok: true, json: async () => [{ ref: "refs/tags/v3.0.0", object: { sha: SHA, type: "commit" } }] }));
    render(<BuildCard />);
    const card = within(screen.getByTestId("admin-build"));
    await waitFor(() => expect(card.getByText("Release").nextElementSibling?.textContent).toBe("untagged"));
    expect(card.getByText("Environment").nextElementSibling?.textContent).toBe("Preview · my-branch");
  });

  it("says it couldn't check, not untagged, when GitHub can't be asked", async () => {
    built({ VERSION: "3.0.0", SHA, ENV: "production" });
    github(async () => {
      throw new Error("offline");
    });
    render(<BuildCard />);
    await waitFor(() => expect(within(screen.getByTestId("admin-build")).getByText("Release").nextElementSibling?.textContent).toBe("Couldn't check"));
  });

  it("is plain about a local build, with no commit to link", async () => {
    built({ VERSION: "3.0.0" });
    render(<BuildCard />);
    const card = within(screen.getByTestId("admin-build"));
    await waitFor(() => expect(card.getByText("Release").nextElementSibling?.textContent).toBe("untagged"));
    expect(card.getByText("Commit").nextElementSibling?.textContent).toBe("local");
    expect(card.getByText("Environment").nextElementSibling?.textContent).toBe("Local");
  });
});
