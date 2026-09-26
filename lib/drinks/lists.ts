// The standard wine lists (a Notion decision of 2026-09-20: "standard
// wine lists stored locally"). The add form offers them as suggestions,
// and search and filters use them to file different spellings together.
// What someone typed is always kept as written; these only match it.
//
// They live in the code rather than the database: they change only when
// we decide they should, and every screen reads them without a query.

export const DRINK_TYPES = ["red", "white", "rosé", "sparkling", "dessert", "fortified", "orange"] as const;
export type DrinkType = (typeof DRINK_TYPES)[number];

export const TYPE_NAMES: Record<DrinkType, string> = {
  red: "Red",
  white: "White",
  rosé: "Rosé",
  sparkling: "Sparkling",
  dessert: "Dessert",
  fortified: "Fortified",
  orange: "Orange",
};

// Each grape once, under its usual name, with the other names it goes
// by. "Shiraz" and "Syrah" stay as written but filter together.
export const GRAPES: readonly { name: string; also?: readonly string[] }[] = [
  { name: "Cabernet Sauvignon" },
  { name: "Merlot" },
  { name: "Pinot Noir", also: ["Spätburgunder", "Pinot Nero", "Blauburgunder"] },
  { name: "Syrah", also: ["Shiraz"] },
  { name: "Grenache", also: ["Garnacha", "Cannonau"] },
  { name: "Tempranillo", also: ["Tinta Roriz", "Aragonez", "Tinto Fino", "Tinta del País"] },
  { name: "Sangiovese", also: ["Brunello", "Prugnolo Gentile", "Morellino"] },
  { name: "Nebbiolo", also: ["Spanna", "Chiavennasca"] },
  { name: "Malbec", also: ["Côt", "Auxerrois"] },
  { name: "Zinfandel", also: ["Primitivo", "Tribidrag"] },
  { name: "Cabernet Franc", also: ["Bouchet"] },
  { name: "Petit Verdot" },
  { name: "Carménère" },
  { name: "Mourvèdre", also: ["Monastrell", "Mataro"] },
  { name: "Carignan", also: ["Cariñena", "Mazuelo", "Carignano"] },
  { name: "Cinsault", also: ["Cinsaut"] },
  { name: "Gamay" },
  { name: "Barbera" },
  { name: "Dolcetto" },
  { name: "Montepulciano" },
  { name: "Aglianico" },
  { name: "Nero d'Avola", also: ["Calabrese"] },
  { name: "Corvina" },
  { name: "Touriga Nacional" },
  { name: "Pinotage" },
  { name: "Tannat" },
  { name: "Blaufränkisch", also: ["Lemberger", "Kékfrankos"] },
  { name: "Zweigelt" },
  { name: "Petite Sirah", also: ["Durif"] },
  { name: "Mencía", also: ["Jaen"] },
  { name: "Xinomavro" },
  { name: "Agiorgitiko" },
  { name: "Saperavi" },
  { name: "Lambrusco" },
  { name: "Pinot Meunier", also: ["Meunier"] },
  { name: "Chardonnay" },
  { name: "Sauvignon Blanc", also: ["Fumé Blanc"] },
  { name: "Riesling" },
  { name: "Pinot Grigio", also: ["Pinot Gris", "Grauburgunder"] },
  { name: "Chenin Blanc", also: ["Steen"] },
  { name: "Sémillon", also: ["Semillon"] },
  { name: "Viognier" },
  { name: "Gewürztraminer", also: ["Gewurztraminer", "Traminer"] },
  { name: "Grüner Veltliner" },
  { name: "Albariño", also: ["Alvarinho"] },
  { name: "Verdejo" },
  { name: "Godello" },
  { name: "Muscat", also: ["Moscato", "Moscatel", "Muskateller"] },
  { name: "Pinot Blanc", also: ["Pinot Bianco", "Weissburgunder"] },
  { name: "Marsanne" },
  { name: "Roussanne" },
  { name: "Vermentino", also: ["Rolle"] },
  { name: "Garganega" },
  { name: "Trebbiano", also: ["Ugni Blanc"] },
  { name: "Glera", also: ["Prosecco"] },
  { name: "Macabeo", also: ["Viura"] },
  { name: "Xarel·lo", also: ["Xarello"] },
  { name: "Parellada" },
  { name: "Furmint" },
  { name: "Assyrtiko" },
  { name: "Torrontés" },
  { name: "Melon de Bourgogne", also: ["Muscadet"] },
  { name: "Aligoté" },
  { name: "Silvaner", also: ["Sylvaner"] },
  { name: "Müller-Thurgau", also: ["Rivaner"] },
  { name: "Fiano" },
  { name: "Greco" },
  { name: "Falanghina" },
  { name: "Cortese" },
  { name: "Arneis" },
  { name: "Palomino" },
  { name: "Pedro Ximénez", also: ["PX"] },
  { name: "Loureiro" },
  { name: "Arinto" },
  { name: "Encruzado" },
  { name: "Colombard" },
  { name: "Petit Manseng" },
  { name: "Gros Manseng" },
];

export const COUNTRIES: readonly string[] = [
  "Argentina",
  "Australia",
  "Austria",
  "Brazil",
  "Canada",
  "Chile",
  "China",
  "Croatia",
  "England",
  "France",
  "Georgia",
  "Germany",
  "Greece",
  "Hungary",
  "India",
  "Israel",
  "Italy",
  "Japan",
  "Lebanon",
  "Mexico",
  "Moldova",
  "New Zealand",
  "Portugal",
  "Romania",
  "Slovenia",
  "South Africa",
  "Spain",
  "Switzerland",
  "Turkey",
  "United States",
  "Uruguay",
];

// Other ways a country is written on a label, filed under the name above.
export const COUNTRY_SYNONYMS: Record<string, string> = {
  usa: "United States",
  "u.s.a.": "United States",
  us: "United States",
  america: "United States",
  "united kingdom": "England",
  uk: "England",
  frankreich: "France",
  italia: "Italy",
  españa: "Spain",
  espana: "Spain",
  deutschland: "Germany",
  österreich: "Austria",
  osterreich: "Austria",
  "suisse": "Switzerland",
  schweiz: "Switzerland",
  "nz": "New Zealand",
  "rsa": "South Africa",
};

// Major regions and appellations, each with its country.
export const REGIONS: readonly { name: string; country: string }[] = [
  { name: "Bordeaux", country: "France" },
  { name: "Médoc", country: "France" },
  { name: "Pauillac", country: "France" },
  { name: "Margaux", country: "France" },
  { name: "Saint-Émilion", country: "France" },
  { name: "Pomerol", country: "France" },
  { name: "Pessac-Léognan", country: "France" },
  { name: "Sauternes", country: "France" },
  { name: "Burgundy", country: "France" },
  { name: "Chablis", country: "France" },
  { name: "Côte de Nuits", country: "France" },
  { name: "Côte de Beaune", country: "France" },
  { name: "Mâconnais", country: "France" },
  { name: "Beaujolais", country: "France" },
  { name: "Champagne", country: "France" },
  { name: "Alsace", country: "France" },
  { name: "Loire", country: "France" },
  { name: "Sancerre", country: "France" },
  { name: "Vouvray", country: "France" },
  { name: "Muscadet", country: "France" },
  { name: "Rhône", country: "France" },
  { name: "Côte-Rôtie", country: "France" },
  { name: "Hermitage", country: "France" },
  { name: "Crozes-Hermitage", country: "France" },
  { name: "Châteauneuf-du-Pape", country: "France" },
  { name: "Côtes du Rhône", country: "France" },
  { name: "Provence", country: "France" },
  { name: "Languedoc", country: "France" },
  { name: "Roussillon", country: "France" },
  { name: "Cahors", country: "France" },
  { name: "Jura", country: "France" },
  { name: "Piedmont", country: "Italy" },
  { name: "Barolo", country: "Italy" },
  { name: "Barbaresco", country: "Italy" },
  { name: "Tuscany", country: "Italy" },
  { name: "Chianti", country: "Italy" },
  { name: "Chianti Classico", country: "Italy" },
  { name: "Brunello di Montalcino", country: "Italy" },
  { name: "Bolgheri", country: "Italy" },
  { name: "Veneto", country: "Italy" },
  { name: "Valpolicella", country: "Italy" },
  { name: "Soave", country: "Italy" },
  { name: "Prosecco", country: "Italy" },
  { name: "Franciacorta", country: "Italy" },
  { name: "Alto Adige", country: "Italy" },
  { name: "Friuli", country: "Italy" },
  { name: "Sicily", country: "Italy" },
  { name: "Etna", country: "Italy" },
  { name: "Puglia", country: "Italy" },
  { name: "Campania", country: "Italy" },
  { name: "Abruzzo", country: "Italy" },
  { name: "Rioja", country: "Spain" },
  { name: "Ribera del Duero", country: "Spain" },
  { name: "Priorat", country: "Spain" },
  { name: "Rías Baixas", country: "Spain" },
  { name: "Rueda", country: "Spain" },
  { name: "Cava", country: "Spain" },
  { name: "Penedès", country: "Spain" },
  { name: "Jerez", country: "Spain" },
  { name: "Toro", country: "Spain" },
  { name: "Bierzo", country: "Spain" },
  { name: "Douro", country: "Portugal" },
  { name: "Porto", country: "Portugal" },
  { name: "Vinho Verde", country: "Portugal" },
  { name: "Dão", country: "Portugal" },
  { name: "Alentejo", country: "Portugal" },
  { name: "Madeira", country: "Portugal" },
  { name: "Mosel", country: "Germany" },
  { name: "Rheingau", country: "Germany" },
  { name: "Pfalz", country: "Germany" },
  { name: "Rheinhessen", country: "Germany" },
  { name: "Baden", country: "Germany" },
  { name: "Nahe", country: "Germany" },
  { name: "Franken", country: "Germany" },
  { name: "Wachau", country: "Austria" },
  { name: "Kamptal", country: "Austria" },
  { name: "Burgenland", country: "Austria" },
  { name: "Tokaj", country: "Hungary" },
  { name: "Santorini", country: "Greece" },
  { name: "Naoussa", country: "Greece" },
  { name: "Napa Valley", country: "United States" },
  { name: "Sonoma", country: "United States" },
  { name: "Paso Robles", country: "United States" },
  { name: "Santa Barbara", country: "United States" },
  { name: "Willamette Valley", country: "United States" },
  { name: "Columbia Valley", country: "United States" },
  { name: "Walla Walla", country: "United States" },
  { name: "Finger Lakes", country: "United States" },
  { name: "Okanagan Valley", country: "Canada" },
  { name: "Niagara Peninsula", country: "Canada" },
  { name: "Mendoza", country: "Argentina" },
  { name: "Salta", country: "Argentina" },
  { name: "Patagonia", country: "Argentina" },
  { name: "Maipo Valley", country: "Chile" },
  { name: "Colchagua", country: "Chile" },
  { name: "Casablanca Valley", country: "Chile" },
  { name: "Barossa Valley", country: "Australia" },
  { name: "McLaren Vale", country: "Australia" },
  { name: "Coonawarra", country: "Australia" },
  { name: "Margaret River", country: "Australia" },
  { name: "Yarra Valley", country: "Australia" },
  { name: "Clare Valley", country: "Australia" },
  { name: "Eden Valley", country: "Australia" },
  { name: "Hunter Valley", country: "Australia" },
  { name: "Tasmania", country: "Australia" },
  { name: "Marlborough", country: "New Zealand" },
  { name: "Central Otago", country: "New Zealand" },
  { name: "Hawke's Bay", country: "New Zealand" },
  { name: "Martinborough", country: "New Zealand" },
  { name: "Stellenbosch", country: "South Africa" },
  { name: "Swartland", country: "South Africa" },
  { name: "Franschhoek", country: "South Africa" },
  { name: "Constantia", country: "South Africa" },
  { name: "Bekaa Valley", country: "Lebanon" },
  { name: "Kakheti", country: "Georgia" },
];

// Sparkling sweetness, driest first, and how sparkling wine is made
// (REQ-27).
export const SWEETNESS: readonly string[] = [
  "Brut Nature",
  "Extra Brut",
  "Brut",
  "Extra Dry",
  "Sec",
  "Demi-Sec",
  "Doux",
];

export const METHODS: readonly string[] = ["Traditional", "Tank (Charmat)", "Ancestral (pét-nat)", "Transfer", "Carbonated"];

// Common bottle sizes, in millilitres.
export const BOTTLE_SIZES: readonly { ml: number; name: string }[] = [
  { ml: 187, name: "Piccolo (187 ml)" },
  { ml: 375, name: "Half (375 ml)" },
  { ml: 500, name: "500 ml" },
  { ml: 750, name: "Standard (750 ml)" },
  { ml: 1000, name: "1 litre" },
  { ml: 1500, name: "Magnum (1.5 l)" },
  { ml: 3000, name: "Double magnum (3 l)" },
];

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const GRAPE_BY_NAME = new Map<string, string>();
for (const grape of GRAPES) {
  for (const spelling of [grape.name, ...(grape.also ?? [])]) GRAPE_BY_NAME.set(fold(spelling), grape.name);
}

// The standard name a grape is filed under, or what was written if it
// isn't on the list. Accents and case don't matter: "shiraz" is Syrah.
export function standardGrape(written: string): string {
  return GRAPE_BY_NAME.get(fold(written)) ?? written.trim();
}

const COUNTRY_BY_NAME = new Map<string, string>([
  ...COUNTRIES.map((country) => [fold(country), country] as [string, string]),
  ...Object.entries(COUNTRY_SYNONYMS).map(([spelling, country]) => [fold(spelling), country] as [string, string]),
]);

export function standardCountry(written: string): string {
  return COUNTRY_BY_NAME.get(fold(written)) ?? written.trim();
}

// Every spelling that files under the same standard grape as `written`,
// folded, so a search for "shiraz" also finds "Syrah".
export function grapeSpellings(written: string): string[] {
  const standard = standardGrape(written);
  const grape = GRAPES.find((row) => row.name === standard);
  if (!grape) return [fold(written)];
  return [grape.name, ...(grape.also ?? [])].map(fold);
}

export { fold };
