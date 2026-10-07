// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddRecipe } from "./forms";
import { saveForNow, startVideoImport } from "./actions";

vi.mock("../../lib/drinks/shrink-photo", () => ({ shrinkPhoto: vi.fn(async () => ({ full: new Blob(["x"], { type: "image/jpeg" }), thumb: new Blob(["x"], { type: "image/jpeg" }) })) }));
vi.mock("../../lib/meal-plans/video-upload", () => ({ sendVideo: vi.fn(async () => {}) }));
vi.mock("../../lib/meal-plans/kept-video", () => ({ keepVideo: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({
  addRecipe: vi.fn(),
  draftFromLink: vi.fn(),
  draftFromPage: vi.fn(),
  draftFromText: vi.fn(),
  draftGeneric: vi.fn(),
  findRecipePages: vi.fn(),
  saveRecipeMissing: vi.fn(),
  dismissImport: vi.fn(),
  saveDraft: vi.fn(),
  saveForNow: vi.fn(async () => ({})),
  setDraftPhoto: vi.fn(),
  setRecipePhoto: vi.fn(),
  startImagesImport: vi.fn(),
  startVideoImport: vi.fn(),
  updateRecipe: vi.fn(),
  uploadFailed: vi.fn(),
  videoProgress: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const chooseSource = (name: string) => {
  const select = screen.getByRole("combobox", { name: /Source/ }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: Array.from(select.options).find((item) => item.text === name)!.value } });
};

// REQ-174: Save for now keeps what is given so far.
describe("Save for now (REQ-174)", () => {
  const saved = () => vi.mocked(saveForNow).mock.calls[0][1];

  it("sends the name, and a recipe page link typed into the method below", async () => {
    render(<AddRecipe />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Test pasta" } });
    chooseSource("From a recipe page link");
    fireEvent.change(screen.getByRole("textbox", { name: /Link to the recipe page/ }), { target: { value: "https://recipes.example.com/pasta/" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save for now" }));
    });
    expect(saved().get("name")).toBe("Test pasta");
    expect(saved().get("page_url")).toBe("https://recipes.example.com/pasta/");
  });

  it("sends a video link typed into the video method", async () => {
    render(<AddRecipe />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Test tacos" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Link to the video/ }), { target: { value: "https://www.instagram.com/reel/x" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save for now" }));
    });
    expect(saved().get("video_url")).toBe("https://www.instagram.com/reel/x");
    expect(saved().get("page_url")).toBeNull();
  });

  it("sends just the name when no link was typed", async () => {
    render(<AddRecipe />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Test soup" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save for now" }));
    });
    expect(saved().get("name")).toBe("Test soup");
    expect(saved().get("page_url")).toBeNull();
    expect(saved().get("video_url")).toBeNull();
  });
});

// REQ-182: the caption under a video.
describe("a video's caption (REQ-182)", () => {
  const pickVideo = () => {
    const input = screen.getByLabelText("The downloaded video") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["v"], "dish.mp4", { type: "video/mp4" })] } });
  };
  const sent = () => vi.mocked(startVideoImport).mock.calls[0][0];

  it("is optional: with none, the video goes as it does today", async () => {
    vi.mocked(startVideoImport).mockResolvedValue({ error: "stop here" });
    render(<AddRecipe />);
    pickVideo();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Read the recipe" }));
    });
    expect(sent().getAll("caption_image")).toHaveLength(0);
    expect(sent().get("caption_text")).toBe("");
  });

  it("sends pasted text and up to 2 screenshots with the video", async () => {
    vi.mocked(startVideoImport).mockResolvedValue({ error: "stop here" });
    render(<AddRecipe />);
    pickVideo();
    fireEvent.change(screen.getByRole("textbox", { name: /Or paste the caption/ }), { target: { value: "2 cups dal" } });
    const shots = new File(["s"], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Caption screenshots"), { target: { files: [shots, shots] } });
    expect(screen.getByRole("button", { name: "2 screenshots chosen" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Read the recipe" }));
    });
    expect(sent().get("caption_text")).toBe("2 cups dal");
    expect(sent().getAll("caption_image")).toHaveLength(2);
  });

  it("refuses a third screenshot before sending anything", async () => {
    render(<AddRecipe />);
    pickVideo();
    const shot = new File(["s"], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Caption screenshots"), { target: { files: [shot, shot, shot] } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Read the recipe" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Up to 2 caption screenshots.");
    expect(startVideoImport).not.toHaveBeenCalled();
  });

  it("keeps the video flow's BETA label", () => {
    render(<AddRecipe />);
    expect(screen.getByText("BETA")).toBeTruthy();
  });
});
