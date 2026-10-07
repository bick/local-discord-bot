import { z } from "zod";
import type { Category } from "@prisma/client";
import { fetchJson, sleep } from "../lib/http.js";
import { logger } from "../logger.js";
import type { EventSource, FetchResult, NormalizedEvent } from "./types.js";

// Downtown Dallas; a 40 mile radius reaches Fort Worth, Denton, McKinney, and Arlington.
const DFW = { lat: 32.7767, lon: -96.797, range: "40mi" };
const PER_PAGE = 100;
const MAX_PAGES = 15;

const nullish = <T extends z.ZodTypeAny>(s: T) => s.nullish();

const SgEvent = z.object({
  id: z.number(),
  title: z.string(),
  short_title: nullish(z.string()),
  description: nullish(z.string()),
  datetime_utc: z.string(),
  enddatetime_utc: nullish(z.string()),
  date_tbd: nullish(z.boolean()),
  time_tbd: nullish(z.boolean()),
  datetime_tbd: nullish(z.boolean()),
  url: z.string().url(),
  score: nullish(z.number()),
  popularity: nullish(z.number()),
  type: nullish(z.string()),
  status: nullish(z.string()),
  taxonomies: nullish(z.array(z.object({ name: z.string() }))),
  venue: nullish(
    z.object({
      name: nullish(z.string()),
      city: nullish(z.string()),
      location: nullish(z.object({ lat: z.number(), lon: z.number() })),
    }),
  ),
  performers: nullish(
    z.array(
      z.object({
        image: nullish(z.string()),
        images: nullish(z.record(z.string(), z.string().nullish())),
      }),
    ),
  ),
  stats: nullish(z.object({ lowest_price: nullish(z.number()) })),
});

const SgResponse = z.object({
  events: z.array(z.unknown()),
  meta: z.object({ total: z.number(), page: z.number(), per_page: z.number() }),
});

type SgEvent = z.infer<typeof SgEvent>;

const SPORTS_HINTS = ["sports", "nba", "nfl", "nhl", "mlb", "mls", "wnba", "ncaa", "football", "baseball", "basketball", "hockey", "soccer", "rodeo", "racing", "wrestling", "fighting", "golf", "tennis"];

export function seatgeekCategory(e: Pick<SgEvent, "type" | "taxonomies">): Category {
  const tags = [e.type ?? "", ...(e.taxonomies ?? []).map((t) => t.name)].map((t) => t.toLowerCase());
  if (tags.some((t) => t.includes("festival"))) return "FESTIVAL";
  if (tags.some((t) => t === "concert" || t.includes("concert") || t.includes("music"))) return "CONCERT";
  if (tags.some((t) => SPORTS_HINTS.some((h) => t.includes(h)))) return "SPORTS";
  if (tags.some((t) => t.includes("family") || t.includes("circus") || t.includes("children"))) return "FAMILY";
  if (tags.some((t) => t.includes("food") || t.includes("wine") || t.includes("beer"))) return "FOOD";
  return "OTHER";
}

/** SeatGeek's datetime_utc has no zone suffix; it is UTC. */
function parseUtc(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

export function normalizeSeatgeek(e: SgEvent): NormalizedEvent {
  const performer = e.performers?.find((p) => p.images?.huge || p.image);
  const tbd = Boolean(e.date_tbd || e.time_tbd || e.datetime_tbd);
  const popularity = Math.max(e.popularity ?? 0, e.score ?? 0);
  return {
    source: "SEATGEEK",
    sourceId: String(e.id),
    title: e.title,
    description: e.description || null,
    category: seatgeekCategory(e),
    venueName: e.venue?.name ?? null,
    city: e.venue?.city ?? null,
    lat: e.venue?.location?.lat ?? null,
    lng: e.venue?.location?.lon ?? null,
    startsAt: parseUtc(e.datetime_utc),
    endsAt: e.enddatetime_utc ? parseUtc(e.enddatetime_utc) : null,
    allDay: tbd,
    url: e.url,
    imageUrl: performer?.images?.huge ?? performer?.image ?? null,
    priceMin: e.stats?.lowest_price ?? null,
    popularity: Math.min(1, Math.max(0, popularity)),
    cancelled: e.status === "cancelled" || e.status === "canceled",
  };
}

export class SeatGeekSource implements EventSource {
  name = "seatgeek";

  constructor(private readonly clientId: string) {}

  async fetchUpcoming({ from, to }: { from: Date; to: Date }): Promise<FetchResult> {
    const events: NormalizedEvent[] = [];
    let complete = false;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        client_id: this.clientId,
        lat: String(DFW.lat),
        lon: String(DFW.lon),
        range: DFW.range,
        per_page: String(PER_PAGE),
        page: String(page),
        sort: "datetime_utc.asc",
        "datetime_utc.gte": from.toISOString().slice(0, 19),
        "datetime_utc.lte": to.toISOString().slice(0, 19),
      });
      const body = SgResponse.parse(await fetchJson(`https://api.seatgeek.com/2/events?${params}`));

      for (const raw of body.events) {
        const parsed = SgEvent.safeParse(raw);
        if (parsed.success) events.push(normalizeSeatgeek(parsed.data));
        else logger.debug({ issues: parsed.error.issues.slice(0, 3) }, "skipping malformed SeatGeek event");
      }

      if (page * PER_PAGE >= body.meta.total || body.events.length === 0) {
        complete = true;
        break;
      }
      await sleep(500); // be polite
    }

    if (!complete) logger.warn({ fetched: events.length }, "SeatGeek page cap reached; skipping cancellation sweep");
    return { events, complete };
  }
}
