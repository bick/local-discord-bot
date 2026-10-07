import type { Event, Prisma } from "@prisma/client";
import { chicagoDay } from "../lib/time.js";
import { normalizeTitle, normalizeVenue } from "./normalize.js";

export interface DedupeInput {
  title: string;
  startsAt: Date;
  venueName?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** normalized title | Chicago calendar day | venue (or ~1km rounded coordinates). */
export function dedupeKey(e: DedupeInput): string {
  const place = normalizeVenue(e.venueName) || (e.lat != null && e.lng != null ? `${e.lat.toFixed(2)},${e.lng.toFixed(2)}` : "");
  return `${normalizeTitle(e.title)}|${chicagoDay(e.startsAt)}|${place}`;
}

type Mergeable = Pick<
  Event,
  "source" | "title" | "description" | "category" | "venueName" | "city" | "lat" | "lng" | "startsAt" | "endsAt" | "allDay" | "url" | "imageUrl" | "priceMin" | "popularity" | "feedId"
>;

/**
 * Merge an incoming duplicate into an existing row from the other source.
 * SeatGeek wins on price, image, popularity, exact times, and coordinates;
 * the official calendar wins on description, URL, and category.
 */
export function mergeDuplicate(existing: Mergeable, incoming: Mergeable): Prisma.EventUpdateInput {
  const sg = incoming.source === "SEATGEEK" ? incoming : existing.source === "SEATGEEK" ? existing : null;
  const cal = incoming.source === "CALENDAR" ? incoming : existing.source === "CALENDAR" ? existing : null;
  if (!sg || !cal) {
    // Same source type twice (e.g. two calendar feeds): fill gaps only.
    return {
      description: existing.description ?? incoming.description,
      imageUrl: existing.imageUrl ?? incoming.imageUrl,
      venueName: existing.venueName ?? incoming.venueName,
      city: existing.city ?? incoming.city,
      url: existing.url || incoming.url,
    };
  }
  return {
    title: cal.title,
    description: cal.description ?? sg.description,
    category: cal.category !== "OTHER" ? cal.category : sg.category,
    url: cal.url || sg.url,
    imageUrl: sg.imageUrl ?? cal.imageUrl,
    priceMin: sg.priceMin ?? cal.priceMin,
    popularity: sg.popularity,
    venueName: sg.venueName ?? cal.venueName,
    city: sg.city ?? cal.city,
    lat: sg.lat ?? cal.lat,
    lng: sg.lng ?? cal.lng,
    startsAt: sg.allDay ? cal.startsAt : sg.startsAt,
    endsAt: cal.endsAt ?? sg.endsAt,
    allDay: sg.allDay && cal.allDay,
    feed: cal.feedId ? { connect: { id: cal.feedId } } : undefined,
  };
}

/** The part of a dedupe key before the venue. */
export function dedupePrefix(key: string): string {
  return key.slice(0, key.lastIndexOf("|") + 1);
}

/** Venues match if either is unknown or one normalized name contains the other ("oak point" vs "oak point and nature preserve"). */
export function venuesMatch(a: string, b: string): boolean {
  const va = a.slice(a.lastIndexOf("|") + 1);
  const vb = b.slice(b.lastIndexOf("|") + 1);
  if (!va || !vb) return true;
  return va === vb || va.includes(vb) || vb.includes(va);
}
