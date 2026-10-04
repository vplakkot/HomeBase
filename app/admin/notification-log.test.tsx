// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogRow } from "../../lib/notifications/log";
import { NotificationLog } from "./notification-log";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(cleanup);

const NOW = Date.parse("2026-10-04T18:00:00Z");
const names = new Map([["u1", "Test Alex"]]);

// Newest first, one a minute apart; every third arrived, the rest are missing.
function rows(count: number): LogRow[] {
  return Array.from({ length: count }, (_, i) => {
    const sent = new Date(NOW - (i + 10) * 60_000).toISOString();
    return {
      id: `row-${i}`,
      sent_at: sent,
      trigger: "manual" as const,
      user_id: "u1",
      device: "abc123def456",
      delivered_at: i % 3 === 0 ? sent : null,
      tapped_at: null,
      accepted: true,
      failure_code: null,
    };
  });
}

describe("the notification log in pages (REQ-126)", () => {
  it("shows 25 rows to a page, newest first, and says which page it is", () => {
    render(<NotificationLog rows={rows(60)} names={names} now={NOW} />);
    expect(screen.getAllByRole("row")).toHaveLength(26);
    const first = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[0].querySelector("time");
    expect(first?.getAttribute("datetime")).toBe(rows(60)[0].sent_at);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/admin?page=2");
  });

  it("moves between pages with Previous and Next, and the last page holds the rest", () => {
    render(<NotificationLog rows={rows(60)} names={names} now={NOW} page={3} />);
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/admin?page=2");
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("keeps the summary on the whole window, whatever page is showing", () => {
    // 60 rows, one in three arrived: 20 arrived, 40 missing.
    render(<NotificationLog rows={rows(60)} names={names} now={NOW} page={3} />);
    expect(screen.getByText(/60 sent, 20 arrived, 40 missing/)).toBeTruthy();
  });

  it("has no page links for a log that fits on one page, and clamps a page that doesn't exist", () => {
    render(<NotificationLog rows={rows(25)} names={names} now={NOW} />);
    expect(screen.queryByRole("navigation", { name: "Log pages" })).toBeNull();
    cleanup();
    render(<NotificationLog rows={rows(30)} names={names} now={NOW} page={99} />);
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });
});

describe("times in the viewer's own zone (#93)", () => {
  it("draws the fixed UTC time first, then the viewer's local time, keeping the exact instant", async () => {
    render(<NotificationLog rows={rows(1)} names={names} now={NOW} />);
    const time = screen.getAllByRole("row")[1].querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe("2026-10-04T17:50:00.000Z");
    // After mount it is the viewer's local format, not the UTC text.
    await waitFor(() => expect(time.textContent).not.toMatch(/UTC/));
    expect(time.textContent).toBe(new Date("2026-10-04T17:50:00.000Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
    expect(screen.queryByText("Sent (UTC)")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Sent" })).toBeTruthy();
  });
});
