import type { Category, Source } from "@prisma/client";
import { spanDays } from "../lib/time.js";

export interface ScoreInput {
  source: Source;
  title: string;
  description?: string | null;
  category: Category;
  venueName?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  /** SeatGeek popularity/score, 0..1. */
  popularity?: number | null;
  /** Feed trustWeight, 0..100. */
  feedTrustWeight?: number | null;
}

/** Rough capacities for DFW venues. Matched against the lowercased venue name. */
export const VENUE_CAPACITY: Array<[RegExp, number]> = [
  [/\bat ?& ?t stadium\b|\bat and t stadium\b|\bcowboys stadium\b/, 80_000],
  [/\bcotton bowl\b/, 92_000],
  [/\bfair park\b/, 100_000],
  [/\bglobe life field\b/, 40_000],
  [/\bchoctaw\b|\btoyota (park|stadium)\b/, 20_000],
  [/\bamerican airlines\b/, 20_000],
  [/\bdickies\b/, 14_000],
  [/\bwill rogers\b/, 10_000],
  [/\bdos equis\b|\bdallas pavilion\b|\bstarplex\b/, 20_000],
  [/\bcomerica\b/, 7_000],
  [/\btoyota music factory\b|\bpavilion at toyota\b/, 8_000],
  [/\boak point\b/, 50_000],
  [/\bcollege park\b|\bcollege park center\b/, 7_000],
  [/\bmajestic\b|\bbomb factory\b|\bfactory in deep ellum\b|\bsouth side ballroom\b|\bsouthside ballroom\b/, 4_000],
  [/\bbass performance\b|\bmeyerson\b|\bwinspear\b/, 2_000],
  [/\bdallas arboretum\b|\barboretum\b/, 10_000],
  [/\bklyde warren\b/, 10_000],
  [/\briverfront\b|\bpanther island\b/, 15_000],
  [/\bfort worth stockyards\b|\bstockyards\b/, 10_000],
];

const BIG_KEYWORDS = /\b(festival|fest|fair|rodeo|stock show|parade|fireworks|balloon|championship|playoffs?|finals?|bowl|tour)\b/i;
const SMALL_KEYWORDS = /\b(council|commission|board meeting|committee|story ?time|workshop|class|webinar|book club|open mic|trivia|support group|hearing|tutoring)\b/i;

export function venueCapacity(venueName: string | null | undefined): number | null {
  const v = venueName?.toLowerCase().replace(/\s+/g, " ").trim();
  if (!v) return null;
  for (const [re, cap] of VENUE_CAPACITY) if (re.test(v)) return cap;
  return null;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

/**
 * 0..100 "is this a big deal?" score. Pure so it's easy to unit test and tune.
 *
 * Base: SeatGeek popularity (up to 55) or calendar feed trust (up to 60).
 * Boosts: venue capacity (up to 20), category (up to 10), multi-day (up to 10), keywords (8).
 * Penalty: civic-meeting / small-program keywords (-30).
 */
export function bigScore(e: ScoreInput): number {
  let score = 0;

  if (e.popularity != null) score += 55 * Math.sqrt(clamp(e.popularity, 0, 1));
  if (e.feedTrustWeight != null) score += 0.6 * clamp(e.feedTrustWeight);

  const cap = venueCapacity(e.venueName);
  if (cap != null) score += cap >= 40_000 ? 20 : cap >= 15_000 ? 15 : cap >= 7_000 ? 10 : cap >= 3_000 ? 5 : 0;

  const categoryBoost: Record<Category, number> = { FESTIVAL: 10, SPORTS: 8, CONCERT: 5, FOOD: 4, FAMILY: 2, OTHER: 0 };
  score += categoryBoost[e.category];

  const days = spanDays(e.startsAt, e.endsAt, e.allDay ?? false);
  if (days >= 2) score += Math.min(10, 4 + (days - 2) * 2);

  if (BIG_KEYWORDS.test(e.title)) score += 8;
  if (SMALL_KEYWORDS.test(e.title)) score -= 30;

  return Math.round(clamp(score));
}
