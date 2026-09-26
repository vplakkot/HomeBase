import { describe, expect, it } from "vitest";
import { parseLabel, type LabelLine } from "./parse-label";

// Invented labels; no real wine. Heights stand for how big each line was
// printed; photo 0 is the front, 1 the back.
const line = (text: string, height = 20, photo = 0, confidence = 0.97): LabelLine => ({ text, height, confidence, photo });

const RIOJA = [
  line("BODEGAS FICTICIAS", 60),
  line("Reserva Especial", 90),
  line("RIOJA", 40),
  line("Denominación de Origen Calificada", 12),
  line("2019", 35),
  line("Tempranillo · Garnacha", 14, 1),
  line("14% vol", 12, 1),
  line("750 ml", 12, 1),
  line("Product of Spain", 10, 1),
  line("Contains sulfites", 8, 1),
];

describe("reading a label (REQ-27)", () => {
  it("fills what the labels show: producer, name, vintage, grapes, region, country, alcohol, size", () => {
    const { found, fields } = parseLabel(RIOJA, 2026);
    expect(found).toBe(true);
    expect(fields).toMatchObject({
      producer: "BODEGAS FICTICIAS",
      name: "Reserva Especial",
      vintage: 2019,
      grapes: ["Tempranillo", "Garnacha"],
      region: "Rioja",
      country: "Spain",
      abv: 14,
      bottle_ml: 750,
    });
  });

  it("leaves blank what isn't there: no type from a grape, no country from a region", () => {
    const { fields } = parseLabel(
      [line("Made-up Estate", 60), line("Old Vine", 80), line("Barossa Valley", 30), line("Shiraz", 25)],
      2026,
    );
    expect(fields.type).toBeUndefined();
    expect(fields.country).toBeUndefined();
    expect(fields.vintage).toBeUndefined();
    expect(fields.grapes).toEqual(["Shiraz"]);
  });

  it("finds nothing on a photo with no text", () => {
    expect(parseLabel([])).toEqual({ found: false, fields: {}, unsure: [] });
  });

  it("marks producer and name to check when they're only the biggest text, and trusts a Bodega or Château", () => {
    expect(parseLabel(RIOJA, 2026).unsure).toEqual(["name"]);
    expect(parseLabel([line("Big Words", 80), line("Smaller words", 40)], 2026).unsure.sort()).toEqual(["name", "producer"]);
  });

  it("marks a field read with low confidence", () => {
    const { fields, unsure } = parseLabel([line("Château Imaginaire", 60), line("2O18 2018", 30, 0, 0.5)], 2026);
    expect(fields.vintage).toBe(2018);
    expect(unsure).toContain("vintage");
  });

  it("reads a sparkling wine's sweetness, method and disgorgement, and calls it sparkling", () => {
    const { fields } = parseLabel(
      [
        line("Maison Pretend", 50),
        line("Blanc de Blancs", 70),
        line("CHAMPAGNE", 40),
        line("Extra Brut", 20),
        line("Méthode traditionnelle", 12, 1),
        line("Dégorgé en mars 2021", 10, 1),
        line("12,5% vol", 10, 1),
      ],
      2026,
    );
    expect(fields).toMatchObject({
      type: "sparkling",
      sweetness: "Extra Brut",
      method: "Traditional",
      disgorged_on: "2021-03-01",
      abv: 12.5,
      region: "Champagne",
      producer: "Maison Pretend",
      name: "Blanc de Blancs",
    });
  });

  it("reads NV, and ignores a founding year", () => {
    const { fields } = parseLabel([line("Cave Fictive", 50), line("Brut Rosé", 60), line("NV", 20), line("Depuis 1887", 10)], 2026);
    expect(fields.non_vintage).toBe(true);
    expect(fields.vintage).toBeUndefined();
  });

  it("keeps sparkling words off a still wine", () => {
    const { fields } = parseLabel([line("Domaine Inventé", 50), line("Vin Rouge", 40), line("Sec", 20)], 2026);
    expect(fields.type).toBe("red");
    expect(fields.sweetness).toBeUndefined();
  });

  it("matches types, grapes and countries to their standard names", () => {
    const { fields } = parseLabel([line("Weingut Erfunden", 50), line("Spätburgunder Trocken", 40), line("Deutschland", 12), line("Rotwein", 12)], 2026);
    expect(fields).toMatchObject({ type: "red", country: "Germany", grapes: ["Spätburgunder"] });
  });

  it("reads bottle sizes in cl and litres", () => {
    expect(parseLabel([line("Magnum 1,5 L", 20)], 2026).fields.bottle_ml).toBe(1500);
    expect(parseLabel([line("37,5 cl", 20)], 2026).fields.bottle_ml).toBe(375);
  });
});

// The labels from Vin's real scans of 2026-09-26, as lines like Vision's.
describe("real labels (REQ-27, 2026-09-26)", () => {
  it("La Sonriente: a name over two lines of the same size is one name", () => {
    const { fields } = parseLabel(
      [
        line("LA", 48),
        line("SONRIENTE", 52),
        line("2024", 20),
        line("GARNACHA", 16),
        line("Spanish Red Wine", 12),
        line("CALATAYUD", 18, 1),
        line("DENOMINACIÓN DE ORIGEN", 8, 1),
        line("BOTTLED BY R.E. 50/42902-ES / 50200-SPAIN", 7, 1),
        line("750 ML. ALC. 14% BY VOL.", 10, 1),
      ],
      2026,
    );
    expect(fields).toMatchObject({
      name: "LA SONRIENTE",
      vintage: 2024,
      grapes: ["Garnacha"],
      type: "red",
      region: "Calatayud",
      abv: 14,
      bottle_ml: 750,
    });
    // A bottler given as a code isn't a producer.
    expect(fields.producer).toBeUndefined();
  });

  it("Convento da Vila: the winery, not the sustainability seal; every grape; Alentejano; a 1 litre bottle", () => {
    const { fields } = parseLabel(
      [
        line("CONVENTO", 44),
        line("DA VILA", 50),
        line("VINHO REGIONAL", 12),
        line("ALENTEJANO", 14),
        line("PORTUGAL", 10),
        line("PRODUÇÃO SUSTENTÁVEL", 30),
        line("2023", 14),
        line("ADEGA DE BORBA", 12),
        line("Established 1955", 8),
        line("40% Trincadeira, 30% Castelão, 20% Aragonez, 10% Touriga Franca", 9, 1),
        line("PRODUZIDO E ENGARRAFADO POR: / PRODUCED AND BOTTLED BY:", 7, 1),
        line("ADEGA COOPERATIVA DE BORBA, CRL BORBA / PORTUGAL", 7, 1),
        line("13,5% vol | 13.5% ALC/VOL", 14, 1),
        line("1Lℯ", 14, 1),
      ],
      2026,
    );
    expect(fields).toMatchObject({
      name: "CONVENTO DA VILA",
      producer: "ADEGA DE BORBA",
      vintage: 2023,
      grapes: ["Trincadeira", "Castelão", "Aragonez", "Touriga Franca"],
      region: "Alentejo",
      country: "Portugal",
      abv: 13.5,
      bottle_ml: 1000,
    });
  });

  it("Pinot Grigio: the grape can be the name, and the back label finishes a cut-off producer", () => {
    const { fields } = parseLabel(
      [
        line("Gaetano D'Aquin", 40),
        line("PINOT GRIGIO", 60),
        line("DELLE VENEZIE", 42),
        line("DENOMINAZIONE DI ORIGINE CONTROLLATA", 14),
        line("2025", 18),
        line("PRODUCT OF ITALY", 10),
        line("Gaetano D'Aquino", 30, 1),
        line("NET CONT. 750 ml ALC. 12% BY VOL", 9, 1),
        line("BOTTLED BY: IT/1207/VR - ITALY", 8, 1),
      ],
      2026,
    );
    expect(fields).toMatchObject({
      name: "PINOT GRIGIO",
      producer: "Gaetano D'Aquino",
      vintage: 2025,
      grapes: ["Pinot Grigio"],
      region: "Delle Venezie",
      country: "Italy",
      abv: 12,
      bottle_ml: 750,
    });
  });

  it("takes the winery from 'bottled by' when the front names none", () => {
    const { fields } = parseLabel(
      [line("Quiet Hill", 60), line("2021", 20), line("Produced and bottled by: Imaginary Cellars, Sonoma", 8, 1)],
      2026,
    );
    expect(fields).toMatchObject({ name: "Quiet Hill", producer: "Imaginary Cellars" });
  });
});
