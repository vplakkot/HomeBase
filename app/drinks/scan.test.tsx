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
import WinesPage from "./wines/page";
import ScanPage from "./scan/page";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back: vi.fn() }),
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
// Which file pickers were opened (a test can't see the camera itself).
function clicks() {
  const spy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
  return () => {
    const labels = spy.mock.contexts.map((input) => (input as HTMLInputElement).getAttribute("aria-label"));
    spy.mockRestore();
    return labels;
  };
}
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

  it("shows the photo with Read it, Add back label and Retake, which takes it again the same way", async () => {
    given();
    render(await ScanPage());
    await pick("Take the front label");
    expect(screen.getByRole("img", { name: "Front label, as taken" })).toBeTruthy();
    expect(button("Read it")).toBeTruthy();
    expect(button("Add back label")).toBeTruthy();
    const opened = clicks();
    fireEvent.click(button("Retake"));
    expect(opened()).toEqual(["Take the front label"]);
    await pick("Take the front label");
    expect(screen.getAllByRole("img", { name: "Front label, as taken" })).toHaveLength(1);
  });

  it("opens the camera for the back label straight away, and reads both without another tap", async () => {
    given();
    render(await ScanPage());
    await pick("Take the front label");
    const opened = clicks();
    fireEvent.click(button("Add back label"));
    expect(opened()).toEqual(["Take the back label"]);
    await pick("Take the back label");
    await waitFor(() => expect(noReader).toHaveBeenCalled());
    expect(vi.mocked(noReader).mock.calls[0][0]).toHaveLength(2);
    const photos = await screen.findByRole("region", { name: "Label photos" });
    expect(within(photos).getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["Front label", "Back label"]);
  });

  it("takes the back label from the library after a front chosen there, and reads the front alone on Read it", async () => {
    given();
    render(await ScanPage());
    await pick("Choose a photo");
    const opened = clicks();
    fireEvent.click(button("Add back label"));
    expect(opened()).toEqual(["Choose the back label"]);
    expect((screen.getByLabelText("Choose the back label") as HTMLInputElement).hasAttribute("capture")).toBe(false);
    await act(async () => {
      fireEvent.click(button("Read it"));
    });
    await screen.findByRole("region", { name: "Check the details" });
    expect(vi.mocked(noReader).mock.calls[0][0]).toHaveLength(1);
  });
});

describe("scanning in fewer taps (REQ-122)", () => {
  it("says Scan, and opens the camera from the Drinks header", async () => {
    given();
    render(await DrinksPage({ searchParams: Promise.resolve({}) }));
    // With nothing recorded, the Overview offers Scan too; the header's comes first.
    const camera = screen.getAllByLabelText("Scan with the camera")[0] as HTMLInputElement;
    expect(camera.getAttribute("capture")).toBe("environment");
    const opened = clicks();
    fireEvent.click(screen.getAllByRole("button", { name: "Scan" })[0]);
    expect(opened()).toEqual(["Scan with the camera"]);
    expect(screen.queryByRole("link", { name: "Scan a label" })).toBeNull();
  });

  it("carries the photo taken there to the scan screen, ready to read", async () => {
    given();
    render(await DrinksPage({ searchParams: Promise.resolve({}) }));
    const camera = screen.getAllByLabelText("Scan with the camera")[0];
    await act(async () => {
      fireEvent.change(camera, { target: { files: [photo()] } });
    });
    expect(push).toHaveBeenCalledWith("/drinks/scan");
    cleanup();
    render(await ScanPage());
    expect(await screen.findByRole("img", { name: "Front label, as taken" })).toBeTruthy();
    // The back label comes from the camera too.
    const opened = clicks();
    fireEvent.click(button("Add back label"));
    expect(opened()).toEqual(["Take the back label"]);
  });

  it("is a screen of its own: no Add by hand or Scan, no Overview, and Cancel", async () => {
    given();
    render(await ScanPage());
    expect(screen.queryByRole("link", { name: "Add by hand" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
    expect(screen.queryByText("Overview", { selector: "header *" })).toBeNull();
    expect(button("Cancel")).toBeTruthy();
  });
});

describe("the review screen (REQ-28)", () => {
  async function review(reading?: LabelReading) {
    if (reading) vi.mocked(noReader).mockResolvedValue(reading);
    given();
    render(await ScanPage());
    await pick("Take the front label");
    await act(async () => {
      fireEvent.click(button("Read it"));
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
    fireEvent.click(button("Try another photo"));
    expect(button("Take the front label")).toBeTruthy();
  });

  it("offers Try another photo even when the label was read", async () => {
    await review({ found: true, fields: { name: "Reserva" }, unsure: [] });
    fireEvent.click(button("Try another photo"));
    expect(button("Choose a photo")).toBeTruthy();
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
    render(await WinesPage({ searchParams: Promise.resolve({}) }));
    const [withPhoto, without] = within(screen.getByRole("region", { name: /Wines/ })).getAllByRole("link");
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

describe("the shop check (REQ-33)", () => {
  const RESERVA = drink("d1", "Reserva Especial", { producer: "Bodegas Ficticias", vintage: 2019 });
  const WISH = drink("d3", "Old Vine", { producer: "Made-up Estate", vintage: 2021, how: "want_to_try" });

  async function scanReading(fields: LabelReading["fields"], drinks: unknown[], ratings: unknown[] = []) {
    vi.mocked(noReader).mockResolvedValue({ found: true, fields, unsure: [] });
    fake = fakeSupabase({
      permissions: ["use_modules"],
      people: [{ user_id: "user-1", name: "Sam", manages_budget: true }],
      tables: { drinks, drink_ratings: ratings },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    render(await ScanPage());
    await pick("Take the front label");
    await act(async () => {
      fireEvent.click(button("Read it"));
    });
    return screen.findByRole("region", { name: "Have we had it?" });
  }

  it("shows a match straight away, from the normal Scan, with stars, comments and buy again", async () => {
    const answer = await scanReading({ producer: "Bodegas Ficticias", name: "Reserva Especial", vintage: 2019 }, [RESERVA], [
      { drink_id: "d1", user_id: "user-1", stars: 2, comment: "thin", buy_again: false, updated_at: "2026-09-21T12:00:00Z" },
    ]);
    expect(within(answer).getByRole("heading").textContent).toBe("We've had this");
    expect(answer.textContent).toContain("Reserva Especial · 2019");
    expect(within(answer).getByRole("list", { name: "Ratings" }).textContent).toBe("Sam ★★☆☆☆ · Buy again: no “thin”");
    expect(within(answer).getByRole("link", { name: "Open existing" }).getAttribute("href")).toBe("/drinks/d1");
    // Nothing saved to show it.
    expect(inserts()).toHaveLength(0);
  });

  it("offers Save as new, which opens the filled-in form", async () => {
    await scanReading({ producer: "Bodegas Ficticias", name: "Reserva Especial", vintage: 2019 }, [RESERVA]);
    expect(screen.queryByRole("region", { name: "Check the details" })).toBeNull();
    fireEvent.click(button("Save as new"));
    const form = screen.getByRole("region", { name: "Check the details" });
    expect((within(form).getByRole("textbox", { name: /^Name/ }) as HTMLInputElement).value).toBe("Reserva Especial");
  });

  it("labels a different vintage as a near match, and still lets me save", async () => {
    const answer = await scanReading({ producer: "Bodegas Ficticias", name: "Reserva Especial", vintage: 2022 }, [RESERVA]);
    expect(within(answer).getByRole("heading").textContent).toBe("A different vintage of one we've had");
    expect(screen.getByRole("region", { name: "Check the details" })).toBeTruthy();
  });

  it("calls out a wine on our want-to-try list", async () => {
    const answer = await scanReading({ producer: "Made-up Estate", name: "Old Vine", vintage: 2021 }, [WISH]);
    expect(within(answer).getByText("On our Want to try list")).toBeTruthy();
  });

  it("says when it's new, with the form to save it or choose Want to try", async () => {
    const answer = await scanReading({ name: "Something Else", vintage: 2020 }, [RESERVA]);
    expect(within(answer).getByRole("heading").textContent).toBe("New to us");
    const form = screen.getByRole("region", { name: "Check the details" });
    expect(within(form).getByRole("radio", { name: "Want to try" })).toBeTruthy();
  });
});

describe("the shop check after a correction (REQ-33)", () => {
  it("looks again when I fix the name, and shows the match without hiding the form", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(noReader).mockResolvedValue({ found: true, fields: { name: "Nothing like it", vintage: 2024 }, unsure: [] });
    fake = fakeSupabase({
      permissions: ["use_modules"],
      people: [{ user_id: "user-1", name: "Sam", manages_budget: true }],
      tables: { drinks: [drink("d9", "LA SONRIENTE", { vintage: 2024 })], drink_ratings: [] },
    });
    vi.mocked(createClient).mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof createClient>>);
    render(await ScanPage());
    await pick("Take the front label");
    await act(async () => {
      fireEvent.click(button("Read it"));
    });
    const answer = await screen.findByRole("region", { name: "Have we had it?" });
    expect(within(answer).getByRole("heading").textContent).toBe("New to us");
    const form = screen.getByRole("region", { name: "Check the details" });
    fireEvent.change(within(form).getByRole("textbox", { name: /^Name/ }), { target: { value: "La Sonriente" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Have we had it?" })).getByRole("heading").textContent).toBe(
        "We've had this",
      ),
    );
    expect(screen.getByRole("region", { name: "Check the details" })).toBeTruthy();
    vi.useRealTimers();
  });
});
