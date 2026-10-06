// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { announceImportsChanged } from "../../lib/meal-plans/import-flag";
import { ImportWatch } from "./import-watch";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// REQ-167
describe("the Meal Plan page redraws when an import moves on", () => {
  it("redraws each time the toast says so", () => {
    render(<ImportWatch />);
    expect(refresh).not.toHaveBeenCalled();
    act(() => announceImportsChanged());
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => announceImportsChanged());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops listening once the page is gone", () => {
    const { unmount } = render(<ImportWatch />);
    unmount();
    act(() => announceImportsChanged());
    expect(refresh).not.toHaveBeenCalled();
  });
});
