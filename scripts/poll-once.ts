/**
 * Run one ingest pass without connecting to Discord and print what would be posted.
 * Useful for tuning the score: `pnpm poll:once`. Pass --no-seatgeek to skip SeatGeek.
 */
import { prisma } from "../src/db.js";
import { buildSources, runIngest } from "../src/pipeline/ingest.js";

// Only needs DATABASE_URL (SEATGEEK_CLIENT_ID optional); no Discord credentials.
const seatgeekClientId = process.argv.includes("--no-seatgeek") ? null : process.env.SEATGEEK_CLIENT_ID || null;
if (seatgeekClientId === null && !process.argv.includes("--no-seatgeek")) console.warn("SEATGEEK_CLIENT_ID not set; calendar feeds only");
const sources = await buildSources({ seatgeekClientId });
const summary = await runIngest(sources, { lookaheadDays: Number(process.env.LOOKAHEAD_DAYS ?? 90) });
console.log({ ...summary, changedEventIds: summary.changedEventIds.length });

const top = await prisma.event.findMany({
  where: { cancelled: false, OR: [{ startsAt: { gte: new Date() } }, { endsAt: { gt: new Date() } }] },
  orderBy: [{ bigScore: "desc" }],
  take: 25,
});
console.table(top.map((e) => ({ score: e.bigScore, when: e.startsAt.toISOString().slice(0, 16), category: e.category, title: e.title.slice(0, 50), venue: e.venueName?.slice(0, 30) })));
await prisma.$disconnect();
