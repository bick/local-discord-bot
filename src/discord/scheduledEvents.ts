import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  type Guild,
  type GuildScheduledEventCreateOptions,
} from "discord.js";
import type { Event } from "@prisma/client";
import { logger } from "../logger.js";
import { isHttpUrl, whereText } from "./embeds.js";

const DEFAULT_DURATION_MS = 3 * 3600_000;

/** Score at or above which we also create a native Discord Scheduled Event. */
export function scheduledEventThreshold(minBigScore: number): number {
  return Math.max(75, minBigScore + 15);
}

function options(e: Event): GuildScheduledEventCreateOptions {
  // External events require an end time.
  const end = e.endsAt && e.endsAt > e.startsAt ? e.endsAt : new Date(e.startsAt.getTime() + DEFAULT_DURATION_MS);
  const description = [e.description?.slice(0, 700), isHttpUrl(e.url) ? e.url : null].filter(Boolean).join("\n\n");
  return {
    name: e.title.slice(0, 100),
    scheduledStartTime: e.startsAt,
    scheduledEndTime: end,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: { location: (whereText(e) ?? "Dallas/Fort Worth").slice(0, 100) },
    description: description.slice(0, 1000) || undefined,
    ...(isHttpUrl(e.imageUrl) ? { image: e.imageUrl } : {}),
  };
}

export async function createScheduledEvent(guild: Guild, e: Event): Promise<string | null> {
  // Discord rejects scheduled events that start in the past.
  if (e.startsAt.getTime() < Date.now() + 60_000 || e.cancelled) return null;
  try {
    const created = await guild.scheduledEvents.create(options(e));
    return created.id;
  } catch (err) {
    logger.warn({ err, guildId: guild.id, eventId: e.id }, "could not create scheduled event (missing Manage Events?)");
    return null;
  }
}

export async function syncScheduledEvent(guild: Guild, scheduledEventId: string, e: Event): Promise<void> {
  try {
    const se = await guild.scheduledEvents.fetch(scheduledEventId);
    if (se.status !== GuildScheduledEventStatus.Scheduled) return;
    if (e.cancelled) {
      await se.edit({ status: GuildScheduledEventStatus.Canceled });
      return;
    }
    if (e.startsAt.getTime() < Date.now()) return;
    const { privacyLevel: _p, ...rest } = options(e);
    await se.edit(rest);
  } catch (err) {
    logger.warn({ err, guildId: guild.id, scheduledEventId }, "could not sync scheduled event");
  }
}
