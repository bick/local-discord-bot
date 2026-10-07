import type { Category } from "@prisma/client";

const DFW_CITIES = [
  "Dallas", "Fort Worth", "Arlington", "Plano", "Frisco", "McKinney", "Irving", "Garland", "Grand Prairie",
  "Mesquite", "Carrollton", "Denton", "Richardson", "Lewisville", "Allen", "Grapevine", "Addison",
  "Southlake", "Flower Mound", "Rockwall", "Mansfield", "Euless", "Bedford", "Hurst", "Keller", "Coppell",
  "Little Elm", "The Colony", "Prosper", "Wylie", "Cedar Hill", "DeSoto", "Duncanville", "Rowlett",
  "Colleyville", "Haltom City", "North Richland Hills", "Burleson", "Weatherford", "Celina", "Farmers Branch",
];

/** Collapse whitespace, strip HTML tags and entities, and cap length. */
export function cleanText(input: string | null | undefined, max = 2000): string | null {
  if (!input) return null;
  const text = input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Find a known DFW city name in free text such as an iCal LOCATION. */
export function detectCity(text: string | null | undefined): string | null {
  if (!text) return null;
  // Longest names first so "North Richland Hills" wins over "Richland".
  const sorted = [...DFW_CITIES].sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    if (new RegExp(`\\b${city.replace(/ /g, "\\s+")}\\b`, "i").test(text)) return city;
  }
  return null;
}

/** "Oak Point Park, 2801 E Spring Creek Pkwy, Plano, TX" -> "Oak Point Park". */
export function venueFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const first = location.split(/,|\n/)[0]?.trim();
  if (!first) return null;
  // A bare street address isn't a venue name.
  if (/^\d+\s/.test(first)) return null;
  return first.slice(0, 200);
}

const CATEGORY_KEYWORDS: Array<[Category, RegExp]> = [
  ["FESTIVAL", /\b(festival|festivals|fest|fair|rodeo|stock show|parade|fireworks|kaboom|carnival|balloon|celebration|jubilee)\b/i],
  ["SPORTS", /\b(sports?|vs\.?|versus|game|match|tournament|marathon|race|5k|10k|mavericks|mavs|stars|cowboys|rangers|wings|fc dallas|stampede|bowl)\b/i],
  ["CONCERT", /\b(concert|tour|live music|symphony|orchestra|band|dj|music)\b/i],
  ["FOOD", /\b(food|wine|beer|bbq|barbecue|taco|chili|brew|tasting|culinary|grapefest)\b/i],
  ["FAMILY", /\b(family|kids|children|story ?time|zoo|aquarium|arboretum|pumpkin|santa|holiday lights|easter)\b/i],
];

/**
 * Keyword-based category for calendar entries. Texts are checked in priority
 * order (title, then feed categories, then description) so a football game whose
 * description mentions "the State Fair" is still SPORTS.
 */
export function guessCategory(...texts: Array<string | null | undefined>): Category {
  for (const text of texts) {
    if (!text) continue;
    for (const [category, re] of CATEGORY_KEYWORDS) if (re.test(text)) return category;
  }
  return "OTHER";
}

/** Normalized title used for dedupe: lowercase, no punctuation, no sponsor suffixes. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+(presented|powered|sponsored|brought to you)\s+by\s+.*$/i, "")
    .replace(/\s*[-–—|:]\s*(tickets?|parking|vip|premium seating).*$/i, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeVenue(venue: string | null | undefined): string {
  if (!venue) return "";
  return venue
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|at|arena|stadium|center|centre|park)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
