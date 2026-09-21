// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MODULES, moduleBySlug } from "../lib/modules";
import { MODULE_ICONS } from "./icons";
import { ModuleTile } from "./module-tile";

afterEach(cleanup);

describe("a module tile", () => {
  it("shows the module's icon, name and one line of status", () => {
    const { container } = render(
      <ModuleTile module={moduleBySlug("calendar")} status="Coming soon" />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("CalendarComing soon");
  });

  it("is one link to the module, when the module has pages", () => {
    const { container } = render(
      <ModuleTile module={moduleBySlug("finances")} status="Coming soon" />,
    );
    const tile = container.firstElementChild!;
    expect(tile.tagName).toBe("A");
    expect(tile.getAttribute("href")).toBe("/finances");
    expect(tile.textContent).toBe("FinancesComing soon");
  });

  it("is not a link while the module has none", () => {
    const { container } = render(<ModuleTile module={moduleBySlug("pets")} status="Coming soon" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("draws in its own module's colours", () => {
    const { container } = render(
      <ModuleTile module={moduleBySlug("wine")} status="Coming soon" />,
    );
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.style.getPropertyValue("--module-quiet")).toBe("var(--wine-quiet)");
  });

  it("has an icon for every module in the list", () => {
    for (const module of MODULES) {
      expect(MODULE_ICONS[module.slug], module.slug).toBeTypeOf("function");
    }
  });
});
