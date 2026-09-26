// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { noReader, type LabelReading } from "../../lib/drinks/label-reader";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { installDialogStandIn } from "../../test/dialog";
import { fakeSupabase } from "../../test/fake-supabase";
import DrinkPage from "./[id]/page";
import DrinksPage from "./page";
import ScanPage from "./scan/page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/drinks",
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  // Saving ends by going to the new drink; here that's only recorded.
  redirect: vi.fn(),
}));
// The browser's canvas isn't here: a photo "shrinks" to a small JPEG.
vi.mock("../../lib/drinks/shrink-photo", () => ({
  shrinkPhoto: vi.fn(async () => ({
    full: new Blob(["full"], { type: "image/jpeg" }),
    thumb: new Blob(["thumb"], { type: "image/jpeg" }),
  })),
}));
// Batch 4 connects the reader; here a test says what it reads.
vi.mock("../../lib/drinks/label-reader", async (original) => ({
  ...(await original<typeof import("../../lib/drinks/label-reader")>()),
  noReader: vi.fn(),
}));

beforeAll(() => {
  installDialogStandIn();
  URL.createObjectURL = vi.fn(() => "blob:photo");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

let fake: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  vi.mocked(noReader).mockResolvedValue({ found: false, fields: {}, unsure: [] });
});

// An invented cellar; nothing here is real.
const drink = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  producer: null,
  type: null,
  vintage: null,
  non_vintage: false,
  grapes: [],
  region: null,
  country: null,
  abv: null,
  bottle_ml: null,
  sweetness: null,
  method: null,
  disgorged_on: null,
  how: "bought",
  price: null,
  place: null,
  gift_from: null,
  front_label: null,
  back_label: null,
  created_at: "2026-09-01T12:00:00Z",
  ...extra,
});

function given(drinks: unknown[] = []) {
  fake = fakeSupabase({
    permissions: ["use_modules"],
    people: [{ user_id: "user-1", name: "Sam", manages_budget: true }],
    tables: { drinks, drink_ratings: [] },
  });
  vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
}

const photo = () => new File(["photo"], "IMG_0001.jpg", { type: "image/jpeg" });
async function pick(name: string) {
  const input = screen.getByLabelText(name) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [photo()] } });
  });
}
const button = (name: string) => screen.getByRole("button", { name });
// Every drink the fake database was asked to add.
const inserts = () =>
  fake.from.mock.results.flatMap(({ value }) => (value.insert as ReturnType<typeof vi.fn>).mock.calls.map(([row]) => row));

describe("scanning a label (REQ-25, REQ-26)", () => {
  it("opens the phone's camera to take the front label, or the photo library to choose one", async () => {
    given();
    render(await ScanPage());
    const camera = screen.getByLabelText("Take the front label") as HTMLInputElement;
    const library = screen.getByLabelText("Choose a photo") as HTMLInputElement;
    expect(camera.getAttribute("capture")).toBe("environment");
    expect(camera.accept).toBe("image/*");
    expect(library.hasAttribute("capture")).toBe(false);
    expect(button("Take the front label")).toBeTruthy();
    expect(button("Choose a photo")).toBeTruthy();
    // A page can't tell that camera access was refused, so how to allow
    // it, and the other way in, are always on screen.
    expect(screen.getByText(/Camera not opening\? Allow it/)).toBeTruthy();
  });

  it("shows the photo with Retake or Use it", async () => {
    given();
    render(await ScanPage());
    await pick("Take the front label");
    expect(screen.getByRole("img", { name: "Front label, as taken" })).toBeTruthy();
    fireEvent.click(button("Retake"));
    expect(screen.queryByRole("img", { name: "Front label, as taken" })).toBeNull();
    expect(button("Take the front label")).toBeTruthy();
  });

  it("offers the back label or Skip, then reads both photos together", async () => {
    given();
    render(await ScanPage());
    await pick("Take the front label");
    fireEvent.click(button("Use it"));
    expect(button("Add back label")).toBeTruthy();
    expect(button("Skip")).toBeTruthy();
    fireEvent.click(button("Add back label"));
    await pick("Take the back label");
    await act(async () => {
      fireEvent.click(button("Use it"));
    });
    await waitFor(() => expect(noReader).toHaveBeenCalled());
    expect(vi.mocked(noReader).mock.calls[0][0]).toHaveLength(2);
    const photos = await screen.findByRole("region", { name: "Label photos" });
    expect(within(photos).getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["Front label", "Back label"]);
  });

  it("works the same from a photo already taken, sending the front alone after Skip", async () => {
    given();
    render(await ScanPage());
    await pick("Choose a photo");
    fireEvent.click(button("Use it"));
    await act(async () => {
      fireEvent.click(button("Skip"));
    });
    await screen.findByRole("region", { name: "Check the details" });
    expect(vi.mocked(noReader).mock.calls[0][0]).toHaveLength(1);
  });
});

describe("the review screen (REQ-28)", () => {
  async function review(reading?: LabelReading) {
    if (reading) vi.mocked(noReader).mockResolvedValue(reading);
    given();
    render(await ScanPage());
    await pick("Take the front label");
    fireEvent.click(button("Use it"));
    await act(async () => {
      fireEvent.click(button("Skip"));
    });
    return screen.findByRole("region", { name: "Check the details" });
  }

  it("shows the photo next to the fields filled from the label, marking any to check", async () => {
    const form = await review({
      found: true,
      fields: { name: "Reserva", producer: "Bodega Ficticia", vintage: 2019, grapes: ["Tempranillo"], type: "red" },
      unsure: ["producer"],
    });
    expect(screen.getByRole("region", { name: "Label photos" })).toBeTruthy();
    expect((within(form).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Reserva");
    expect((within(form).getByRole("textbox", { name: "Vintage (optional)" }) as HTMLInputElement).value).toBe("2019");
    expect(within(form).getByText(/Producer \(optional\)/).textContent).toBe("Producer (optional) · check this");
    expect(within(form).queryByText(/Nothing could be read/)).toBeNull();
  });

  it("says when nothing was read, and lets me fill it in by hand or try another photo", async () => {
    const form = await review();
    expect(within(form).getByRole("status").textContent).toContain("Nothing could be read from the label.");
    expect((within(form).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("");
    fireEvent.click(within(form).getByRole("button", { name: "Try another photo" }));
    expect(button("Take the front label")).toBeTruthy();
  });

  it("saves my corrections with the photo, without asking for a rating", async () => {
    const form = await review({ found: true, fields: { name: "Reserva" }, unsure: [] });
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Reserva Especial" } });
    fireEvent.click(within(form).getByRole("radio", { name: "Bought" }));
    expect(within(form).queryByRole("radio", { name: /star/ })).toBeNull();
    await act(async () => {
      fireEvent.submit(within(form).getByRole("button", { name: "Save" }).closest("form")!);
    });
    await waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0]).toEqual(
      expect.objectContaining({ name: "Reserva Especial", how: "bought", front_label: expect.stringMatching(/-front\.jpg$/) }),
    );
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(expect.stringMatching(/^\/drinks\/[0-9a-f-]{36}$/));
  });

  it("saves nothing on Cancel", async () => {
    const form = await review();
    expect(within(form).getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/drinks");
    expect(fake.storage.bucket.upload).not.toHaveBeenCalled();
    expect(inserts()).toHaveLength(0);
  });
});

describe("photos on the list and the drink's page (REQ-32, REQ-30)", () => {
  const PICTURED = drink("d1", "Reserva", { front_label: "d1/1-front.jpg", back_label: "d1/1-back.jpg" });

  it("shows a label thumbnail in the list, through a private link", async () => {
    given([PICTURED, drink("d2", "Picnic white")]);
    render(await DrinksPage({ searchParams: Promise.resolve({}) }));
    const [withPhoto, without] = within(screen.getByRole("region", { name: /Our drinks/ })).getAllByRole("link");
    expect(withPhoto.querySelector("img")?.getAttribute("src")).toBe("https://signed.example/d1/1-front-thumb.jpg");
    expect(without.querySelector("img")).toBeNull();
  });

  it("shows the full photos on the drink's page", async () => {
    given([PICTURED]);
    render(await DrinkPage({ params: Promise.resolve({ id: "d1" }) }));
    const photos = screen.getByRole("region", { name: "Label photos" });
    expect(within(photos).getAllByRole("img").map((img) => [img.getAttribute("alt"), img.getAttribute("src")])).toEqual([
      ["Front label", "https://signed.example/d1/1-front.jpg"],
      ["Back label", "https://signed.example/d1/1-back.jpg"],
    ]);
  });

  it("lets a drink saved without photos get them later, and one with photos replace them", async () => {
    given([drink("d2", "Picnic white")]);
    render(await DrinkPage({ params: Promise.resolve({ id: "d2" }) }));
    expect(screen.queryByRole("region", { name: "Label photos" })).toBeNull();
    fireEvent.click(button("Manage"));
    fireEvent.click(button("Add label photos"));
    const sheet = screen.getByRole("dialog", { name: "Add label photos" });
    expect(within(sheet).getByRole("button", { name: "Take the front label" })).toBeTruthy();
    cleanup();
    given([PICTURED]);
    render(await DrinkPage({ params: Promise.resolve({ id: "d1" }) }));
    fireEvent.click(button("Manage"));
    expect(button("Replace label photos")).toBeTruthy();
  });
});
