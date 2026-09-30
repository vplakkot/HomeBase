// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markImportSeen, myRecipeImports } from "../app/meal-plans/actions";
import { forgetImports, rememberImports } from "../lib/meal-plans/import-flag";
import { RecipeToast } from "./recipe-toast";

vi.mock("../app/meal-plans/actions", () => ({ myRecipeImports: vi.fn(), markImportSeen: vi.fn(async () => {}) }));

afterEach(() => {
  cleanup();
  forgetImports();
  vi.clearAllMocks();
});

const item = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "66666666-6666-4666-8666-666666666666",
  name: "Test pasta",
  video_url: null,
  status,
  draft: null,
  error: null,
  photo: null,
  seen: false,
  created_at: new Date().toISOString(),
  ...extra,
});

describe("the recipe toast, on any page (REQ-112)", () => {
  it("says Recipe ready with the way to the draft, and goes when dismissed", async () => {
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([item("ready")] as never);
    render(<RecipeToast />);
    expect((await screen.findByText("Recipe ready: Test pasta")).closest("li")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Save recipe" }).getAttribute("href")).toBe("/meal-plans/drafts/66666666-6666-4666-8666-666666666666");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(markImportSeen).toHaveBeenCalledWith("66666666-6666-4666-8666-666666666666");
    expect(screen.queryByText("Recipe ready: Test pasta")).toBeNull();
  });

  it("says plainly when a video couldn't be read", async () => {
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([item("failed")] as never);
    render(<RecipeToast />);
    expect(await screen.findByText("Couldn't read “Test pasta”")).toBeTruthy();
  });

  it("doesn't ask the server at all when this browser started nothing", () => {
    render(<RecipeToast />);
    expect(myRecipeImports).not.toHaveBeenCalled();
  });
});
