import type { RsvpStatus } from "@prisma/client";
import { prisma } from "../db.js";

export type RsvpCounts = Record<RsvpStatus, number>;

export async function rsvpCounts(eventId: string, guildId: string): Promise<RsvpCounts> {
  const rows = await prisma.rsvp.groupBy({ by: ["status"], where: { eventId, guildId }, _count: { _all: true } });
  const counts: RsvpCounts = { GOING: 0, INTERESTED: 0, NOT_FOR_ME: 0 };
  for (const r of rows) counts[r.status] = r._count._all;
  return counts;
}
