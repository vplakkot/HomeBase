import type { DrinkType } from "./lists";
import { COUNTRIES, COUNTRY_SYNONYMS, GRAPES, METHODS, REGIONS, SWEETNESS, fold } from "./lists";
import type { LabelReading, ReadableField } from "./label-reader";

// Turning the text on a label into a drink's details (REQ-27). The text
// reader gives back lines of text, how tall each was printed, and how
// sure it was of them. Everything a list covers (grape, region, country,
// type words, sparkling terms) is found by matching the lists; vintage,
// alcohol and bottle size by their shapes ("2019", "13.5% vol",
// "750 ml"). Producer and wine name have no list, so they're guessed
// from the biggest text left over, and always marked to check.
//
// A field the label doesn't show stays blank: nothing is inferred (a
// region doesn't fill in its country; a grape doesn't make it red).

export type LabelLine = {
  text: string;
  // How tall the text was, in the photo's pixels: labels print the
  // producer and name biggest.
  height: number;
  // The reader's confidence, 0 to 1.
  confidence: number;
  // Which photo: 0 for the front, 1 for the back.
  photo: number;
};

// Below this, a field read from the line is marked "check this".
const SURE = 0.8;

const hasWord = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

// Longest spellings first, so "Pinot Noir" wins over "Pinot" and
// "Chianti Classico" over "Chianti".
const byLength = <T>(items: T[], text: (item: T) => string) =>
  [...items].sort((a, b) => fold(text(b)).length - fold(text(a)).length);

const GRAPE_SPELLINGS = byLength(
  GRAPES.flatMap((grape) => [grape.name, ...(grape.also ?? [])]).filter(
    // Too common as ordinary words on a label to count on their own.
    (name) => !["Prosecco", "Muscadet", "Brunello", "PX"].includes(name),
  ),
  (name) => name,
);
const REGION_NAMES = byLength(
  REGIONS.map((region) => region.name),
  (name) => name,
);
const COUNTRY_SPELLINGS = byLength(
  [...COUNTRIES.map((country) => [country, country] as const), ...Object.entries(COUNTRY_SYNONYMS)].filter(
    // Two-letter synonyms match too much label text.
    ([spelling]) => spelling.length > 3,
  ),
  ([spelling]) => spelling,
);

// Words a label uses for each type, in the languages we're likely to see.
const TYPE_WORDS: [DrinkType, string[]][] = [
  ["sparkling", ["champagne", "cava", "cremant", "prosecco", "franciacorta", "sekt", "spumante", "espumante", "mousseux", "petillant naturel", "pet nat", "sparkling"]],
  ["fortified", ["port", "porto", "sherry", "jerez", "xeres", "madeira", "marsala", "fortified", "vin doux naturel"]],
  ["dessert", ["sauternes", "tokaji aszu", "late harvest", "vendanges tardives", "eiswein", "ice wine", "icewine", "beerenauslese", "trockenbeerenauslese", "passito", "vin santo", "dessert wine"]],
  ["rosé", ["rose", "rosado", "rosato"]],
  ["orange", ["orange wine", "skin contact", "amber wine"]],
  ["red", ["red wine", "vin rouge", "vino rosso", "vino tinto", "rotwein", "tinto", "rosso", "rouge"]],
  ["white", ["white wine", "vin blanc", "vino bianco", "vino blanco", "weisswein", "blanco", "bianco", "blanc"]],
];

const METHOD_WORDS: [string, string[]][] = [
  ["Traditional", ["methode traditionnelle", "methode champenoise", "metodo classico", "metodo tradicional", "traditional method", "classic method", "flaschengarung"]],
  ["Tank (Charmat)", ["charmat", "metodo martinotti", "tank method", "cuve close"]],
  ["Ancestral (pét-nat)", ["methode ancestrale", "petillant naturel", "pet nat", "ancestral method"]],
];

// Words that mark a line as the producer's name.
const PRODUCER_WORDS = [
  "chateau", "domaine", "bodega", "bodegas", "weingut", "cantina", "cantine", "tenuta", "estate", "winery", "vineyards",
  "maison", "clos", "quinta", "castello", "fattoria", "cave", "caves", "azienda", "agricola", "vignobles", "wines",
];

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevrier: 2, february: 2, mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, avril: 4, april: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7,
  aug: 8, aout: 8, august: 8, sep: 9, sept: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12,
};

type Found = Partial<LabelReading["fields"]>;

export function parseLabel(lines: readonly LabelLine[], thisYear = new Date().getFullYear()): LabelReading {
  const fields: Found = {};
  const unsure = new Set<ReadableField>();
  // Lines that gave a field; the rest are candidates for producer and name.
  const used = new Set<number>();
  const bestType: { at: number; line: number } = { at: TYPE_WORDS.length, line: -1 };
  const set = <K extends ReadableField>(field: K, value: Found[K], line: number) => {
    if (fields[field] !== undefined) return;
    fields[field] = value;
    used.add(line);
    if (lines[line].confidence < SURE) unsure.add(field);
  };

  lines.forEach((line, index) => {
    const raw = line.text;
    const text = fold(raw);
    if (text === "") return;

    // Alcohol: "13.5% vol", "alc. 12,5 %", "14% ABV".
    const abv = raw.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:vol|alc|abv)?/i);
    if (abv) {
      const value = Number(abv[1].replace(",", "."));
      if (value >= 4 && value <= 25) set("abv", Math.round(value * 10) / 10, index);
    }

    // Bottle size: "750 ml", "75 cl", "1.5 L", "1,5l".
    const size = raw.match(/\b(\d{1,4}(?:[.,]\d)?)\s*(ml|cl|l|lt|litre|liter)\b/i);
    if (size) {
      const amount = Number(size[1].replace(",", "."));
      const unit = size[2].toLowerCase();
      const ml = Math.round(unit === "ml" ? amount : unit === "cl" ? amount * 10 : amount * 1000);
      if (ml >= 100 && ml <= 15000) set("bottle_ml", ml, index);
    }

    // Disgorged: "dégorgé en mars 2021", "disgorged 03/2021", "degorgement: 2021-03-15".
    if (/\b(degorge|degorgement|disgorged|disgorgement|sboccatura|degüelle|deguelle)\b/.test(text) || /degorg|disgorg/.test(text)) {
      const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
      const numeric = raw.match(/\b(\d{1,2})[./](\d{4})\b/);
      const worded = text.match(/\b([a-z]+) (\d{4})\b/);
      let date: string | null = null;
      if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
      else if (numeric) date = `${numeric[2]}-${numeric[1].padStart(2, "0")}-01`;
      else if (worded && MONTHS[worded[1]]) date = `${worded[2]}-${String(MONTHS[worded[1]]).padStart(2, "0")}-01`;
      if (date) {
        set("disgorged_on", date, index);
        return;
      }
    }

    // Vintage: a year on its own, or "NV" / "non vintage" / "sans année".
    if (/\b(nv|non vintage|sans annee|senza annata|mv|multi vintage)\b/.test(text)) {
      set("non_vintage", true, index);
    } else if (fields.vintage === undefined && !/\b(since|depuis|dal|desde|seit|est|founded|fondee|anno)\b/.test(text)) {
      const years = [...raw.matchAll(/\b(19[5-9]\d|20\d\d)\b/g)].map((match) => Number(match[1])).filter((year) => year <= thisYear);
      if (years.length === 1) set("vintage", years[0], index);
    }

    // Type: the most telling word on any line wins (TYPE_WORDS is in
    // that order), so "Blanc de Blancs … Champagne" is sparkling.
    const typeAt = TYPE_WORDS.findIndex(([, words]) => words.some((word) => hasWord(text, fold(word))));
    if (typeAt >= 0 && typeAt < bestType.at) Object.assign(bestType, { at: typeAt, line: index });

    for (const term of byLength([...SWEETNESS], (term) => term)) {
      if (hasWord(text, fold(term))) {
        set("sweetness", term, index);
        break;
      }
    }

    for (const [method, words] of METHOD_WORDS) {
      if (words.some((word) => hasWord(text, fold(word)))) {
        set("method", method, index);
        break;
      }
    }

    for (const name of REGION_NAMES) {
      if (hasWord(text, fold(name))) {
        set("region", name, index);
        break;
      }
    }

    for (const [spelling, country] of COUNTRY_SPELLINGS) {
      if (hasWord(text, fold(spelling))) {
        set("country", country, index);
        break;
      }
    }

    // Grapes: every one named, as the list spells it, once each.
    let rest = ` ${text} `;
    for (const name of GRAPE_SPELLINGS) {
      const folded = ` ${fold(name)} `;
      if (!rest.includes(folded)) continue;
      rest = rest.replace(folded, " ");
      const grapes = (fields.grapes ??= []);
      if (!grapes.includes(name)) grapes.push(name);
      used.add(index);
      if (line.confidence < SURE) unsure.add("grapes");
    }
  });

  if (bestType.line >= 0) set("type", TYPE_WORDS[bestType.at][0], bestType.line);

  // Sweetness and method are sparkling words; on anything else they're
  // noise ("Sec" on a white is about something else).
  if (fields.type !== undefined && fields.type !== "sparkling") {
    delete fields.sweetness;
    delete fields.method;
    delete fields.disgorged_on;
  }
  // The grape Glera, Macabeo and the like don't make it sparkling, but
  // "Brut" does.
  if (fields.type === undefined && fields.sweetness && ["Brut Nature", "Extra Brut", "Brut"].includes(fields.sweetness)) {
    fields.type = "sparkling";
    unsure.add("type");
  }

  // Producer and name: from the front label, the biggest text that
  // nothing else claimed.
  const left = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => line.photo === 0 && !used.has(index) && /\p{L}{2}/u.test(line.text) && line.text.trim().length <= 60)
    .sort((a, b) => b.line.height - a.line.height);
  const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
  const producer = left.find(({ line }) => PRODUCER_WORDS.some((word) => hasWord(fold(line.text), word)));
  const producerLine = producer ?? left[0];
  if (producerLine) {
    fields.producer = tidy(producerLine.line.text);
    // A producer found by its "Château" or "Bodega" is likely right;
    // the biggest text alone is only a guess.
    if (!producer || producerLine.line.confidence < SURE) unsure.add("producer");
  }
  const nameLine = left.find((candidate) => candidate !== producerLine);
  if (nameLine) {
    fields.name = tidy(nameLine.line.text);
    unsure.add("name");
  } else if (fields.producer) {
    // A label with one big line: that's what we call it.
    fields.name = fields.producer;
    unsure.add("name");
  }

  const found = Object.keys(fields).length > 0;
  return { found, fields, unsure: found ? [...unsure] : [] };
}
