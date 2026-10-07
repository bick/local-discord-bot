/**
 * Seed initial calendar feeds. Safe to re-run: feeds are upserted by URL and
 * existing enabled/trust settings changed via /feeds are left alone.
 *
 * Only feeds whose URLs have been verified belong here. Add more city or venue
 * feeds at runtime with `/feeds add`.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FEEDS = [
  {
    name: "DFW annual festivals (curated)",
    url: "file:feeds/dfw-annual.ics",
    format: "ical",
    defaultCity: "Dallas",
    trustWeight: 90,
  },
];

for (const feed of FEEDS) {
  const row = await prisma.calendarFeed.upsert({
    where: { url: feed.url },
    create: feed,
    update: { name: feed.name, format: feed.format, defaultCity: feed.defaultCity },
  });
  console.log(`feed: ${row.name} (${row.id})`);
}
await prisma.$disconnect();
