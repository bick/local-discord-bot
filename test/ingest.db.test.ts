/**
 * Integration test against a real Postgres. Runs only when TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgresql://... npx prisma migrate deploy && npm test
 * The test database is wiped, so never point this at real data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { EventSource, FetchResult, NormalizedEvent } from "../src/sources/types.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ingest (database)", () => {
  let prisma: PrismaClient;
  let runIngest: typeof import("../src/pipeline/ingest.js").runIngest;
  let SeatGeekSource: typeof import("../src/sources/seatgeek.js").SeatGeekSource;

  const inThreeDays = new Date(Date.now() + 3 * 86400_000);
  const sgGame: NormalizedEvent = {
    source: "SEATGEEK", sourceId: "sg-1", title: "Dallas Mavericks vs. San Antonio Spurs", description: null, category: "SPORTS",
    venueName: "American Airlines Center", city: "Dallas", lat: 32.79, lng: -96.81, startsAt: inThreeDays, endsAt: null, allDay: false,
    url: "https://seatgeek.com/1", imageUrl: "https://img/1.jpg", priceMin: 45, popularity: 0.8,
  };

  /** A SeatGeek-typed fake so the cancellation sweep runs. */
  function fakeSeatGeek(events: NormalizedEvent[]): EventSource {
    const s = Object.create(SeatGeekSource.prototype) as EventSource;
    Object.assign(s, { name: "seatgeek", fetchUpcoming: async (): Promise<FetchResult> => ({ events, complete: true }) });
    return s;
  }
  const fakeCalendar = (events: NormalizedEvent[]): EventSource => ({ name: "cal", fetchUpcoming: async () => ({ events, complete: true }) });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("../src/db.js"));
    ({ runIngest } = await import("../src/pipeline/ingest.js"));
    ({ SeatGeekSource } = await import("../src/sources/seatgeek.js"));
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "Rsvp", "Post", "Event", "CalendarFeed" CASCADE`);
  });
  afterAll(async () => prisma?.$disconnect());

  it("is idempotent across polls", async () => {
    const first = await runIngest([fakeSeatGeek([sgGame])], { lookaheadDays: 30 });
    const second = await runIngest([fakeSeatGeek([sgGame])], { lookaheadDays: 30 });
    expect(first.created).toBe(1);
    expect(second.updated).toBe(1);
    expect(second.changedEventIds).toEqual([]);
    expect(await prisma.event.count()).toBe(1);
  });

  it("merges a venue-calendar duplicate into the SeatGeek row and keeps calendar copy on refresh", async () => {
    const feed = await prisma.calendarFeed.create({ data: { name: "AAC", url: "https://aac.example/cal.ics", format: "ical", trustWeight: 70 } });
    const calGame: NormalizedEvent = {
      ...sgGame, source: "CALENDAR", sourceId: `${feed.id}:game1`, feedId: feed.id, feedTrustWeight: 70,
      title: "Dallas Mavericks vs San Antonio Spurs presented by Chime", description: "Official description",
      venueName: "The American Airlines Center", url: "https://mavs.example/game", imageUrl: null, priceMin: null, popularity: undefined,
      startsAt: new Date(inThreeDays.getTime() + 30 * 60_000),
    };
    await runIngest([fakeCalendar([calGame])], { lookaheadDays: 30 });
    const summary = await runIngest([fakeSeatGeek([sgGame])], { lookaheadDays: 30 });
    expect(summary.merged).toBe(1);

    const rows = await prisma.event.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.source).toBe("SEATGEEK"); // adopted SeatGeek identity for cancellation tracking
    expect(row.description).toBe("Official description");
    expect(row.url).toBe("https://mavs.example/game");
    expect(row.imageUrl).toBe("https://img/1.jpg");
    expect(row.startsAt).toEqual(sgGame.startsAt);
    expect(row.feedId).toBe(feed.id);

    // Next SeatGeek refresh must not clobber the calendar's description/url.
    await runIngest([fakeSeatGeek([{ ...sgGame, priceMin: 60 }]), fakeCalendar([calGame])], { lookaheadDays: 30 });
    const after = await prisma.event.findFirstOrThrow();
    expect(await prisma.event.count()).toBe(1);
    expect(after.description).toBe("Official description");
    expect(Number(after.priceMin)).toBe(60);
  });

  it("cancels SeatGeek events missing for two polls", async () => {
    await runIngest([fakeSeatGeek([sgGame])], { lookaheadDays: 30 });
    const miss1 = await runIngest([fakeSeatGeek([])], { lookaheadDays: 30 });
    expect(miss1.cancelled).toBe(0);
    const miss2 = await runIngest([fakeSeatGeek([])], { lookaheadDays: 30 });
    expect(miss2.cancelled).toBe(1);
    expect(miss2.changedEventIds).toHaveLength(1);
    expect((await prisma.event.findFirstOrThrow()).cancelled).toBe(true);

    // Reappearing un-cancels and reports a change so posts get re-rendered.
    const back = await runIngest([fakeSeatGeek([sgGame])], { lookaheadDays: 30 });
    expect(back.changedEventIds).toHaveLength(1);
    expect((await prisma.event.findFirstOrThrow()).cancelled).toBe(false);
  });

  it("records feed errors without failing the whole poll", async () => {
    const feed = await prisma.calendarFeed.create({ data: { name: "Broken", url: "https://broken.example/x.ics", format: "ical" } });
    const { CalendarSource } = await import("../src/sources/calendar.js");
    const broken = new CalendarSource(feed);
    broken.fetchUpcoming = async () => {
      throw new Error("boom");
    };
    const summary = await runIngest([broken, fakeSeatGeek([sgGame])], { lookaheadDays: 30 });
    expect(summary.errors).toEqual([{ source: "calendar:Broken", error: "boom" }]);
    expect(summary.created).toBe(1);
    expect((await prisma.calendarFeed.findUniqueOrThrow({ where: { id: feed.id } })).lastError).toBe("boom");
  });
});
