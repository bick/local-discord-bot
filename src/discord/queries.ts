import type { Category, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const DEFAULT_MIN_SCORE = 60;

export async function guildMinScore(guildId: string | null): Promise<number> {
  if (!guildId) return DEFAULT_MIN_SCORE;
  const s = await prisma.guildSettings.findUnique({ where: { guildId } });
  return s?.minBigScore ?? DEFAULT_MIN_SCORE;
}

/** Big, upcoming, not-cancelled events. Includes ones already underway (multi-day festivals). */
export async function upcomingBigEvents(opts: {
  from: Date;
  to?: Date;
  minScore: number;
  category?: Category | null;
  city?: string | null;
  take: number;
}) {
  const where: Prisma.EventWhereInput = {
    cancelled: false,
    bigScore: { gte: opts.minScore },
    OR: [{ startsAt: { gte: opts.from } }, { endsAt: { gt: opts.from }, startsAt: { lt: opts.from } }],
    ...(opts.to ? { startsAt: { lt: opts.to } } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.city ? { city: { contains: opts.city, mode: "insensitive" } } : {}),
  };
  return prisma.event.findMany({ where, orderBy: { startsAt: "asc" }, take: opts.take });
}
