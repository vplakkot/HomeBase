// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT, readRules } from "../test/css";
import { AuthPage } from "./auth-page";

afterEach(cleanup);

const rules = readRules(
  readFileSync(join(REPO_ROOT, "components/auth-page.module.css"), "utf-8"),
);
const style = (selector: string) =>
  rules.find((rule) => rule.selector === selector)?.declarations ?? new Map();

// REQ-86.
describe("the page around sign-in, sign-up and set-password", () => {
  it("shows the HomeBase icon and name above the page's own content", () => {
    const { container } = render(
      <AuthPage>
        <h1>Sign in</h1>
      </AuthPage>,
    );
    const icon = container.querySelector("img")!;
    expect(icon.getAttribute("src")).toBe("/icon.svg");
    expect(icon.getAttribute("width")).toBe("72");
    expect(screen.getByText("HomeBase")).toBeDefined();
    expect(container.textContent).toBe("HomeBaseSign in");
  });

  it("centres one column, the same on a phone and a desktop", () => {
    expect(style(".page").get("justify-content")).toBe("center");
    expect(style(".page").get("align-items")).toBe("center");
    expect(style(".column").get("max-width")).toBe("400px");
    expect(rules.some((rule) => rule.media !== null)).toBe(false);
  });

  it("makes fields and the main button 52 px tall, with 16 px text in the fields", () => {
    expect(style(".column input").get("min-height")).toBe("52px");
    expect(style(".column input").get("font-size")).toBe("var(--text-body-lg)");
    expect(style('.column button[type="submit"]').get("min-height")).toBe("52px");
  });

  it("shows a wrong password in the danger colours", () => {
    expect(style('.column [role="alert"]').get("color")).toBe("var(--color-danger)");
    expect(style('.column [role="alert"]').get("background")).toBe("var(--color-danger-bg)");
  });
});
