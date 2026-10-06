// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markImportSeen, myRecipeImports } from "../app/meal-plans/actions";
import { forgetImports, IMPORTS_CHANGED, rememberImports } from "../lib/meal-plans/import-flag";
import { hasVideo, keepVideo, takeVideo } from "../lib/meal-plans/kept-video";
import { RecipeToast } from "./recipe-toast";

vi.mock("../app/meal-plans/actions", () => ({ myRecipeImports: vi.fn(), markImportSeen: vi.fn(async () => {}), setDraftFrame: vi.fn() }));

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

describe("the video kept for its photo (REQ-156)", () => {
  const ID = "66666666-6666-4666-8666-666666666666";

  it("is kept when asking after the imports fails, rather than taken for a removed draft", async () => {
    keepVideo(ID, new Blob(["v"]));
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue(null);
    render(<RecipeToast />);
    await waitFor(() => expect(myRecipeImports).toHaveBeenCalled());
    expect(hasVideo(ID)).toBe(true);
    takeVideo(ID);
  });

  it("is let go once its draft is gone", async () => {
    keepVideo(ID, new Blob(["v"]));
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([]);
    render(<RecipeToast />);
    await waitFor(() => expect(hasVideo(ID)).toBe(false));
  });
});

// REQ-166: tapping "Save recipe" opens the draft, and the toast on the next
// page asks the server before the server has heard "seen". It must not
// bring the note back.
describe("the note goes at the first tap (REQ-166)", () => {
  it("stays gone on the next page even when the server still lists it as unseen", async () => {
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([item("ready", { id: "77777777-7777-4777-8777-777777777777" })] as never);
    const first = render(<RecipeToast />);
    fireEvent.click(await screen.findByRole("link", { name: "Save recipe" }));
    expect(screen.queryByText("Recipe ready: Test pasta")).toBeNull();
    // The next page mounts a new toast; the server hasn't recorded "seen" yet.
    first.unmount();
    render(<RecipeToast />);
    await waitFor(() => expect(myRecipeImports).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Recipe ready: Test pasta")).toBeNull();
  });
});

// REQ-167: the screen locked mid-send; on return the toast said "Recipe
// ready" while the Meal Plan page still said "Sending the video". The page
// is drawn by the server once; the toast is what keeps asking, so it says
// when what it hears has changed.
describe("the page is told when an import moves on (REQ-167)", () => {
  const comesBack = () => document.dispatchEvent(new Event("visibilitychange"));
  const told = vi.fn();
  const listen = () => window.addEventListener(IMPORTS_CHANGED, told);

  afterEach(() => window.removeEventListener(IMPORTS_CHANGED, told));

  it("says so when an import moves on while the phone was locked", async () => {
    listen();
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([item("uploading")] as never);
    render(<RecipeToast />);
    await waitFor(() => expect(myRecipeImports).toHaveBeenCalledTimes(1));
    expect(told).not.toHaveBeenCalled();

    vi.mocked(myRecipeImports).mockResolvedValue([item("ready")] as never);
    comesBack();
    expect(await screen.findByText("Recipe ready: Test pasta")).toBeTruthy();
    await waitFor(() => expect(told).toHaveBeenCalledTimes(1));
  });

  it("says so at each stage, not just the last", async () => {
    listen();
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([item("uploading")] as never);
    render(<RecipeToast />);
    await waitFor(() => expect(myRecipeImports).toHaveBeenCalledTimes(1));
    vi.mocked(myRecipeImports).mockResolvedValue([item("processing")] as never);
    comesBack();
    await waitFor(() => expect(told).toHaveBeenCalledTimes(1));
    vi.mocked(myRecipeImports).mockResolvedValue([item("failed")] as never);
    comesBack();
    await waitFor(() => expect(told).toHaveBeenCalledTimes(2));
  });

  it("says so when an import is gone (removed from another page or device)", async () => {
    listen();
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([item("processing")] as never);
    render(<RecipeToast />);
    await waitFor(() => expect(myRecipeImports).toHaveBeenCalledTimes(1));
    vi.mocked(myRecipeImports).mockResolvedValue([] as never);
    comesBack();
    await waitFor(() => expect(told).toHaveBeenCalledTimes(1));
  });

  it("says nothing when nothing changed", async () => {
    listen();
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([item("processing")] as never);
    render(<RecipeToast />);
    await waitFor(() => expect(myRecipeImports).toHaveBeenCalledTimes(1));
    comesBack();
    await waitFor(() => expect(myRecipeImports).toHaveBeenCalledTimes(2));
    comesBack();
    await waitFor(() => expect(myRecipeImports).toHaveBeenCalledTimes(3));
    expect(told).not.toHaveBeenCalled();
  });

  it("says nothing just because the first answer arrived", async () => {
    listen();
    rememberImports();
    vi.mocked(myRecipeImports).mockResolvedValue([item("ready")] as never);
    render(<RecipeToast />);
    await screen.findByText("Recipe ready: Test pasta");
    expect(told).not.toHaveBeenCalled();
  });
});
