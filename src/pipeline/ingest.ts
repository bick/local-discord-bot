import type { Event, Prisma } from "@prisma/client";
import { addDays } from "date-fns";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { CalendarSource } from "../sources/calendar.js";
import { SeatGeekSource } from "../sources/seatgeek.js";
import type { EventSource, FetchResult, NormalizedEvent } from "../sources/types.js";
import { dedupeKey, dedupePrefix, mergeDuplicate, venuesMatch } from "./dedupe.js";
import { bigScore } from "./score.js";

export interface IngestSummary {
  fetched: number;
  created: number;
  updated: number;
  merged: number;
  cancelled: number;
  /** Events whose posted messages / scheduled events need re-rendering. */
  changedEventIds: string[];
  errors: Array<{ source: string; error: string }>;
}

const MISSED_POLLS_BEFORE_CANCEL = 2;

type EventWithFeed = Event & { feed: { trustWeight: number } | null };

function materiallyChanged(before: Event, after: Event): boolean {
  return (
    before.title !== after.title ||
    before.startsAt.getTime() !== after.startsAt.getTime() ||
    (before.endsAt?.getTime() ?? 0) !== (after.endsAt?.getTime() ?? 0) ||
    before.venueName !== after.venueName ||
    before.cancelled !== after.cancelled ||
    before.allDay !== after.allDay ||
    String(before.priceMin ?? "") !== String(after.priceMin ?? "")
  );
}

function rowData(e: NormalizedEvent): Omit<Prisma.EventUncheckedCreateInput, "dedupeKey"> {
  const { feedTrustWeight: _trust, ...rest } = e;
  return { ...rest, popularity: e.popularity ?? null, cancelled: e.cancelled ?? false };
}

/** Fields a SeatGeek refresh may overwrite on a row that was merged with an official calendar entry. */
function seatgeekOwned(e: NormalizedEvent): Prisma.EventUncheckedUpdateInput {
  return {
    imageUrl: e.imageUrl ?? undefined,
    priceMin: e.priceMin ?? null,
    popularity: e.popularity ?? null,
    venueName: e.venueName ?? undefined,
    lat: e.lat ?? undefined,
    lng: e.lng ?? undefined,
    ...(e.allDay ? {} : { startsAt: e.startsAt }),
    cancelled: e.cancelled ?? false,
  };
}

async function rescore(id: string): Promise<EventWithFeed> {
  const row = await prisma.event.findUniqueOrThrow({ where: { id }, include: { feed: { select: { trustWeight: true } } } });
  const score = bigScore({ ...row, feedTrustWeight: row.feed?.trustWeight ?? null });
  if (score !== row.bigScore) return prisma.event.update({ where: { id }, data: { bigScore: score }, include: { feed: { select: { trustWeight: true } } } });
  return row;
}

type UpsertOutcome = { id: string; kind: "created" | "updated" | "merged"; changed: boolean };

export async function upsertEvent(e: NormalizedEvent): Promise<UpsertOutcome> {
  const key = dedupeKey(e);
  const existing = await prisma.event.findUnique({ where: { source_sourceId: { source: e.source, sourceId: e.sourceId } } });

  if (existing) {
    const mergedRow = existing.source === "SEATGEEK" && existing.feedId != null;
    const data: Prisma.EventUncheckedUpdateInput = mergedRow
      ? { ...seatgeekOwned(e), missedPolls: 0 }
      : { ...rowData(e), dedupeKey: key, missedPolls: 0 };
    await prisma.event.update({ where: { id: existing.id }, data });
    const after = await rescore(existing.id);
    return { id: existing.id, kind: "updated", changed: materiallyChanged(existing, after) };
  }

  // Same event from the other source? Prefix-match on title + day, then compare venues loosely.
  const candidates = await prisma.event.findMany({
    where: { dedupeKey: { startsWith: dedupePrefix(key) } },
    take: 10,
  });
  const dup = candidates.find((c) => venuesMatch(c.dedupeKey, key));
  if (dup) {
    const incoming = { ...rowData(e), feedId: e.feedId ?? null, priceMin: e.priceMin ?? null } as unknown as Event;
    const data = mergeDuplicate(dup, incoming);
    // Adopt the SeatGeek identity so the cancellation sweep keeps tracking it.
    if (e.source === "SEATGEEK" && dup.source === "CALENDAR") {
      Object.assign(data, { source: "SEATGEEK", sourceId: e.sourceId, missedPolls: 0 });
    }
    await prisma.event.update({ where: { id: dup.id }, data });
    const after = await rescore(dup.id);
    return { id: dup.id, kind: "merged", changed: materiallyChanged(dup, after) };
  }

  const created = await prisma.event.create({
    data: {
      ...rowData(e),
      dedupeKey: key,
      bigScore: bigScore({ ...e, feedTrustWeight: e.feedTrustWeight ?? null, popularity: e.popularity ?? null }),
    },
  });
  return { id: created.id, kind: "created", changed: false };
}

async function sweepCancellations(seenSourceIds: Set<string>, from: Date, to: Date): Promise<string[]> {
  const live = await prisma.event.findMany({
    where: { source: "SEATGEEK", cancelled: false, startsAt: { gte: from, lte: to } },
    select: { id: true, sourceId: true, missedPolls: true },
  });
  const cancelledIds: string[] = [];
  for (const ev of live) {
    if (seenSourceIds.has(ev.sourceId)) continue;
    const missedPolls = ev.missedPolls + 1;
    const cancelled = missedPolls >= MISSED_POLLS_BEFORE_CANCEL;
    await prisma.event.update({ where: { id: ev.id }, data: { missedPolls, cancelled } });
    if (cancelled) cancelledIds.push(ev.id);
  }
  return cancelledIds;
}

/** SeatGeek plus every enabled calendar feed. Pass seatgeekClientId: null to skip SeatGeek. */
export async function buildSources(opts: { seatgeekClientId?: string | null } = {}): Promise<EventSource[]> {
  const clientId = opts.seatgeekClientId === undefined ? config().SEATGEEK_CLIENT_ID : opts.seatgeekClientId;
  const feeds = await prisma.calendarFeed.findMany({ where: { enabled: true } });
  return [...(clientId ? [new SeatGeekSource(clientId)] : []), ...feeds.map((f) => new CalendarSource(f))];
}

export async function runIngest(sources?: EventSource[], opts: { lookaheadDays?: number } = {}): Promise<IngestSummary> {
  const from = new Date();
  const to = addDays(from, opts.lookaheadDays ?? config().LOOKAHEAD_DAYS);
  sources ??= await buildSources();

  const results = await Promise.allSettled(sources.map((s) => s.fetchUpcoming({ from, to })));
  const summary: IngestSummary = { fetched: 0, created: 0, updated: 0, merged: 0, cancelled: 0, changedEventIds: [], errors: [] };
  const changed = new Set<string>();

  for (const [i, result] of results.entries()) {
    const source = sources[i]!;
    const feedId = source instanceof CalendarSource ? source.feed.id : null;

    if (result.status === "rejected") {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      summary.errors.push({ source: source.name, error });
      logger.error({ source: source.name, err: error }, "source fetch failed");
      if (feedId) await prisma.calendarFeed.update({ where: { id: feedId }, data: { lastError: error.slice(0, 500) } });
      continue;
    }

    const { events, complete }: FetchResult = result.value;
    summary.fetched += events.length;
    for (const ev of events) {
      try {
        const outcome = await upsertEvent(ev);
        summary[outcome.kind]++;
        if (outcome.changed) changed.add(outcome.id);
      } catch (err) {
        logger.warn({ err, source: source.name, sourceId: ev.sourceId }, "failed to upsert event");
      }
    }

    if (feedId) await prisma.calendarFeed.update({ where: { id: feedId }, data: { lastFetched: new Date(), lastError: null } });

    if (source instanceof SeatGeekSource && complete) {
      const gone = await sweepCancellations(new Set(events.map((e) => e.sourceId)), from, to);
      summary.cancelled += gone.length;
      gone.forEach((id) => changed.add(id));
    }
    logger.info({ source: source.name, count: events.length }, "source ingested");
  }

  summary.changedEventIds = [...changed];
  return summary;
}
