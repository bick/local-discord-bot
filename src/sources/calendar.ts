import { readFile } from "node:fs/promises";
import path from "node:path";
import ical, { type VEvent, type ParameterValue } from "node-ical";
import Parser from "rss-parser";
import { parse as parseDate } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import type { CalendarFeed } from "@prisma/client";
import { TIME_ZONE } from "../config.js";
import { fetchText } from "../lib/http.js";
import { addCalendarDays, chicagoDay, chicagoMidnight } from "../lib/time.js";
import { cleanText, detectCity, guessCategory, venueFromLocation } from "../pipeline/normalize.js";
import type { EventSource, FetchResult, NormalizedEvent } from "./types.js";

type FeedInfo = Pick<CalendarFeed, "id" | "name" | "url" | "format" | "defaultCity" | "trustWeight">;

/** A recurring series (weekly farmers market) shouldn't flood the database. */
const MAX_INSTANCES_PER_SERIES = 12;

function paramText(v: ParameterValue | undefined | null): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && "val" in v) return String((v as { val: unknown }).val);
  return String(v);
}

/** node-ical builds date-only values at local midnight; re-anchor them to Chicago midnight. */
function dateOnlyToChicago(d: Date): Date {
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return chicagoMidnight(day);
}

/** `file:feeds/x.ics` reads from the repo; anything else is fetched. */
export async function loadFeedBody(url: string): Promise<string> {
  if (url.startsWith("file:")) {
    const rel = url.slice("file:".length).replace(/^\/\//, "");
    return readFile(path.resolve(process.cwd(), rel), "utf8");
  }
  return fetchText(url);
}

function isHttpUrl(s: string | null | undefined): s is string {
  return !!s && /^https?:\/\//i.test(s);
}

export function parseIcal(body: string, feed: FeedInfo, window: { from: Date; to: Date }): NormalizedEvent[] {
  const parsed = ical.sync.parseICS(body);
  const out: NormalizedEvent[] = [];

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;
    const vevent = component as VEvent;
    if (vevent.recurrenceid) continue; // overrides are applied via the base event's expansion

    const instances = ical
      .expandRecurringEvent(vevent, { from: window.from, to: window.to, expandOngoing: true })
      .slice(0, MAX_INSTANCES_PER_SERIES);

    for (const inst of instances) {
      const ev = inst.event;
      const title = cleanText(paramText(inst.summary) ?? paramText(ev.summary), 200);
      if (!title) continue;

      let startsAt: Date = inst.start;
      let endsAt: Date | null = inst.end ?? null;
      if (inst.isFullDay) {
        startsAt = dateOnlyToChicago(inst.start);
        endsAt = inst.end && inst.end > inst.start ? dateOnlyToChicago(inst.end) : null;
        endsAt ??= chicagoMidnight(addCalendarDays(chicagoDay(startsAt), 1));
      }

      const location = paramText(ev.location);
      const description = cleanText(paramText(ev.description));
      const rawCategories = (ev as { categories?: string[] }).categories?.join(" ") ?? null;
      const eventUrl = paramText(ev.url as ParameterValue | undefined);

      out.push({
        source: "CALENDAR",
        sourceId: `${feed.id}:${ev.uid}${inst.isRecurring ? `@${inst.start.toISOString()}` : ""}`,
        feedId: feed.id,
        feedTrustWeight: feed.trustWeight,
        title,
        description,
        category: guessCategory(title, rawCategories, description),
        venueName: venueFromLocation(location),
        city: detectCity(location) ?? feed.defaultCity ?? null,
        lat: ev.geo?.lat ?? null,
        lng: ev.geo?.lon ?? null,
        startsAt,
        endsAt,
        allDay: inst.isFullDay,
        url: isHttpUrl(eventUrl) ? eventUrl : isHttpUrl(feed.url) ? feed.url : "",
        imageUrl: null,
        priceMin: null,
        cancelled: ev.status === "CANCELLED",
      });
    }
  }
  return out;
}

type RssItem = {
  title?: string;
  link?: string;
  guid?: string;
  content?: string;
  contentSnippet?: string;
  categories?: string[];
  "ev:startdate"?: string;
  "ev:enddate"?: string;
  "ev:location"?: string;
  "calendarEvent:EventDates"?: string;
  "calendarEvent:EventTimes"?: string;
  "calendarEvent:Location"?: string;
};

const rssParser = new Parser<Record<string, unknown>, RssItem>({
  customFields: {
    item: [
      "ev:startdate",
      "ev:enddate",
      "ev:location",
      "calendarEvent:EventDates",
      "calendarEvent:EventTimes",
      "calendarEvent:Location",
    ],
  },
});

function chicagoLocal(dateStr: string, timeStr?: string): Date | null {
  const formats = timeStr ? ["MMMM d, yyyy h:mm a", "MMMM d, yyyy h a", "MMM d, yyyy h:mm a"] : ["MMMM d, yyyy", "MMM d, yyyy"];
  const input = timeStr ? `${dateStr.trim()} ${timeStr.trim().toUpperCase()}` : dateStr.trim();
  for (const fmt of formats) {
    const local = parseDate(input, fmt, new Date(2000, 0, 1));
    if (!Number.isNaN(local.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      const wall = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}:00`;
      return fromZonedTime(wall, TIME_ZONE);
    }
  }
  return null;
}

/** ISO from ev:startdate; values without an offset are Chicago wall time. */
function parseIsoish(s: string): { date: Date; dateOnly: boolean } | null {
  const v = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: chicagoMidnight(v), dateOnly: true };
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(v);
  const date = hasZone ? new Date(v) : fromZonedTime(v, TIME_ZONE);
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false };
}

/** Pull start/end from the RSS event module or CivicPlus calendar fields. RSS pubDate is not an event date. */
export function rssItemTimes(item: RssItem): { startsAt: Date; endsAt: Date | null; allDay: boolean } | null {
  if (item["ev:startdate"]) {
    const start = parseIsoish(item["ev:startdate"]);
    if (!start) return null;
    const end = item["ev:enddate"] ? parseIsoish(item["ev:enddate"]) : null;
    return { startsAt: start.date, endsAt: end?.date ?? null, allDay: start.dateOnly };
  }
  const dates = item["calendarEvent:EventDates"];
  if (dates) {
    const [startDay, endDay] = dates.split(/\s+-\s+/);
    const [startTime, endTime] = (item["calendarEvent:EventTimes"] ?? "").split(/\s+-\s+/).map((t) => t.trim()).filter(Boolean);
    if (!startDay) return null;
    const startsAt = chicagoLocal(startDay, startTime);
    if (!startsAt) return null;
    const endsAt = endTime ? chicagoLocal(endDay ?? startDay, endTime) : endDay ? chicagoLocal(endDay) : null;
    return { startsAt, endsAt, allDay: !startTime };
  }
  return null;
}

export async function parseRss(body: string, feed: FeedInfo, window: { from: Date; to: Date }): Promise<NormalizedEvent[]> {
  const parsed = await rssParser.parseString(body);
  const out: NormalizedEvent[] = [];
  for (const item of parsed.items) {
    const times = rssItemTimes(item);
    const title = cleanText(item.title, 200);
    if (!times || !title) continue;
    if (times.startsAt > window.to || (times.endsAt ?? times.startsAt) < window.from) continue;
    const location = item["ev:location"] ?? item["calendarEvent:Location"] ?? null;
    const description = cleanText(item.content ?? item.contentSnippet);
    out.push({
      source: "CALENDAR",
      sourceId: `${feed.id}:${item.guid ?? item.link ?? `${title}@${times.startsAt.toISOString()}`}`,
      feedId: feed.id,
      feedTrustWeight: feed.trustWeight,
      title,
      description,
      category: guessCategory(title, item.categories?.join(" "), description),
      venueName: venueFromLocation(location),
      city: detectCity(location) ?? feed.defaultCity ?? null,
      lat: null,
      lng: null,
      ...times,
      url: isHttpUrl(item.link) ? item.link : isHttpUrl(feed.url) ? feed.url : "",
      imageUrl: null,
      priceMin: null,
    });
  }
  return out;
}

export class CalendarSource implements EventSource {
  readonly name: string;

  constructor(readonly feed: FeedInfo) {
    this.name = `calendar:${feed.name}`;
  }

  async fetchUpcoming(window: { from: Date; to: Date }): Promise<FetchResult> {
    const body = await loadFeedBody(this.feed.url);
    const events = this.feed.format === "rss" ? await parseRss(body, this.feed, window) : parseIcal(body, this.feed, window);
    return { events, complete: true };
  }
}
