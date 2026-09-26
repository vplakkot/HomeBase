import { describe, expect, it } from "vitest";
import type { Drink, Rating } from "./drinks";
import { shopCheck } from "./match";

// An invented cellar and household; nothing here is real.
const drink = (id: string, name: string, extra: Partial<Drink> = {}): Drink => ({
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
const RESERVA_19 = drink("d1", "Reserva Especial", { producer: "Bodegas Ficticias", vintage: 2019 });
const RESERVA_16 = drink("d2", "Reserva Especial", { producer: "Bodegas Ficticias", vintage: 2016 });
const WISH = drink("d3", "Old Vine", { producer: "Made-up Estate", vintage: 2021, how: "want_to_try" });
const OTHER_PRODUCER = drink("d4", "Reserva Especial", { producer: "Someone Else", vintage: 2019 });
const DRINKS = [RESERVA_19, RESERVA_16, WISH, OTHER_PRODUCER];
const PEOPLE = [
  { user_id: "sam", name: "Sam" },
  { user_id: "alex", name: "Alex" },
];
const RATINGS: Rating[] = [
  { drink_id: "d1", user_id: "sam", stars: 2, comment: "thin", buy_again: false, updated_at: "2026-09-21T12:00:00Z" },
];

const check = (read: Parameters<typeof shopCheck>[0]) => shopCheck(read, DRINKS, PEOPLE, RATINGS);

describe("the shop check (REQ-33)", () => {
  it("matches on producer, name and vintage, however they're capitalised", () => {
    const result = check({ producer: "BODEGAS FICTICIAS", name: "reserva especial", vintage: 2019 });
    expect(result.kind).toBe("same");
    if (result.kind !== "same") return;
    expect(result.drinks.map((row) => row.id)).toEqual(["d1"]);
  });

  it("shows the match's name, everyone's stars and comments, and buy again", () => {
    const result = check({ producer: "Bodegas Ficticias", name: "Reserva Especial", vintage: 2019 });
    if (result.kind !== "same") throw new Error(result.kind);
    expect(result.drinks[0]).toMatchObject({
      name: "Reserva Especial",
      vintage: "2019",
      wanted: false,
      ratings: [
        { name: "Sam", stars: 2, comment: "thin", buyAgain: "Buy again: no" },
        { name: "Alex", stars: null, comment: null, buyAgain: null },
      ],
    });
  });

  it("calls a different vintage of the same wine a near match", () => {
    const result = check({ producer: "Bodegas Ficticias", name: "Reserva Especial", vintage: 2021 });
    expect(result.kind).toBe("near");
    if (result.kind !== "near") return;
    expect(result.drinks.map((row) => row.vintage)).toEqual(["2019", "2016"]);
  });

  it("calls out a match on our want-to-try list", () => {
    const result = check({ producer: "Made-up Estate", name: "Old Vine", vintage: 2021 });
    if (result.kind !== "same") throw new Error(result.kind);
    expect(result.drinks[0].wanted).toBe(true);
  });

  it("says it's new when nothing matches", () => {
    expect(check({ producer: "Nobody", name: "Nothing like it", vintage: 2020 }).kind).toBe("new");
  });

  it("matches on name and vintage when the label gave no producer", () => {
    const result = check({ name: "Reserva Especial", vintage: 2019 });
    if (result.kind !== "same") throw new Error(result.kind);
    expect(result.drinks.map((row) => row.id).sort()).toEqual(["d1", "d4"]);
  });

  it("can't check without a name", () => {
    expect(check({ producer: "Bodegas Ficticias" }).kind).toBe("unknown");
  });
});

describe("the shop check on real readings (REQ-33, 2026-09-26)", () => {
  const SONRIENTE = drink("d9", "LA SONRIENTE", { vintage: 2024 });

  it("still finds a wine whose name the reading split into producer and name", () => {
    const result = shopCheck({ producer: "SONRIENTE", name: "LA", vintage: 2024 }, [SONRIENTE], PEOPLE, []);
    expect(result.kind).toBe("same");
  });

  it("finds it however the name is corrected: whole, or name and producer swapped", () => {
    expect(shopCheck({ name: "La Sonriente", vintage: 2024 }, [SONRIENTE], PEOPLE, []).kind).toBe("same");
    expect(shopCheck({ name: "Sonriente", producer: "La", vintage: 2024 }, [SONRIENTE], PEOPLE, []).kind).toBe("same");
  });

  it("never matches on a short word alone", () => {
    expect(shopCheck({ name: "LA", vintage: 2024 }, [SONRIENTE], PEOPLE, []).kind).toBe("new");
  });
});
