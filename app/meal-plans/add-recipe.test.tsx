// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddRecipe } from "./forms";
import { saveForNow } from "./actions";

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
