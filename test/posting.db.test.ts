/** Runs only when TEST_DATABASE_URL is set (see ingest.db.test.ts). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Event, PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
const DAY = 86400_000;

describe.skipIf(!url)("postCandidates (database)", () => {
  let prisma: PrismaClient;
  let postCandidates: typeof import("../src/discord/posting.js").postCandidates;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("../src/db.js"));
    ({ postCandidates } = await import("../src/discord/posting.js"));
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "Rsvp", "Post", "Event", "CalendarFeed", "GuildSettings" CASCADE`);
  });
  afterAll(async () => prisma?.$disconnect());

  let n = 0;
  const make = (over: Partial<Event>) =>
    prisma.event.create({
      data: {
        source: "CALENDAR", sourceId: `e${n++}`, title: "Event", url: "https://x", dedupeKey: `k${n}`,
        startsAt: new Date(Date.now() + 2 * DAY), bigScore: 80, category: "FESTIVAL", ...over,
      } as never,
    });

  it("picks big upcoming and ongoing multi-day events, best first, skipping posted/cancelled/filtered", async () => {
    const settings = await prisma.guildSettings.create({ data: { guildId: "g1", eventsChannelId: "c1", minBigScore: 60, categories: ["FESTIVAL", "SPORTS"] } });
    const best = await make({ title: "best", bigScore: 95 });
    const ongoing = await make({ title: "ongoing fair", startsAt: new Date(Date.now() - 10 * DAY), endsAt: new Date(Date.now() + 10 * DAY), allDay: true });
    await make({ title: "ending today", startsAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() + 3600_000) });
    await make({ title: "too small", bigScore: 40 });
    await make({ title: "cancelled", cancelled: true });
    await make({ title: "concert filtered out", category: "CONCERT" });
    await make({ title: "too far out", startsAt: new Date(Date.now() + 120 * DAY) });
    const posted = await make({ title: "already posted" });
    await prisma.post.create({ data: { eventId: posted.id, guildId: "g1", channelId: "c1", messageId: "m1" } });

    const picks = await postCandidates(settings);
    expect(picks.map((e) => e.id)).toEqual([best.id, ongoing.id]);
  });
});
