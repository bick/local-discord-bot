import { ChannelType, type Client, type Guild, type GuildTextBasedChannel } from "discord.js";
import type { Event, GuildSettings, Post } from "@prisma/client";
import { addDays } from "date-fns";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { chicagoDay, chicagoMidnight } from "../lib/time.js";
import { eventEmbed, rsvpButtons, threadName } from "./embeds.js";
import { rsvpCounts } from "./rsvp.js";
import { createScheduledEvent, scheduledEventThreshold, syncScheduledEvent } from "./scheduledEvents.js";

/** Don't auto-post things more than this far out; they'll get picked up on a later poll. */
const POST_HORIZON_DAYS = 45;

export async function resolveTextChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
  return channel;
}

/** Upcoming events this guild hasn't seen yet that clear its bar, best first. */
export async function postCandidates(settings: GuildSettings, now = new Date()): Promise<Event[]> {
  return prisma.event.findMany({
    where: {
      cancelled: false,
      startsAt: { lte: addDays(now, POST_HORIZON_DAYS) },
      // Upcoming, or a multi-day festival already underway with at least a day left.
      OR: [{ startsAt: { gte: now } }, { endsAt: { gte: addDays(now, 1) } }],
      bigScore: { gte: settings.minBigScore },
      ...(settings.categories.length ? { category: { in: settings.categories } } : {}),
      posts: { none: { guildId: settings.guildId } },
    },
    orderBy: [{ bigScore: "desc" }, { startsAt: "asc" }],
    take: 25,
  });
}

export async function postEvent(guild: Guild, channel: GuildTextBasedChannel, settings: GuildSettings, event: Event): Promise<Post> {
  const counts = await rsvpCounts(event.id, guild.id);
  const message = await channel.send({ embeds: [eventEmbed(event, counts)], components: [rsvpButtons(event, counts)] });

  let threadId: string | null = null;
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
    try {
      const thread = await message.startThread({ name: threadName(event.title), autoArchiveDuration: 10080 });
      threadId = thread.id;
      await thread.send("🚗 Use this thread to plan carpools, meetup spots, and tickets. Hit **Going** above and you'll be added here.");
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "could not create event thread (missing Create Public Threads?)");
    }
  }

  const scheduledEventId = event.bigScore >= scheduledEventThreshold(settings.minBigScore) ? await createScheduledEvent(guild, event) : null;

  return prisma.post.create({
    data: { eventId: event.id, guildId: guild.id, channelId: channel.id, messageId: message.id, threadId, scheduledEventId },
  });
}

/** Guilds with a posting run in flight, so the poll job and /populate can't double-post. */
const postingGuilds = new Set<string>();

export type GuildPostResult = { status: "posted"; posted: number } | { status: "busy" | "no-guild" | "no-channel" };

/** Post up to `limit` new candidates to one guild's events channel. */
export async function postToGuild(client: Client, settings: GuildSettings, limit: number): Promise<GuildPostResult> {
  const guild = client.guilds.cache.get(settings.guildId);
  if (!guild) return { status: "no-guild" };
  const channel = settings.eventsChannelId ? await resolveTextChannel(client, settings.eventsChannelId) : null;
  if (!channel) {
    logger.warn({ guildId: guild.id }, "events channel missing or not text based");
    return { status: "no-channel" };
  }
  if (postingGuilds.has(guild.id)) return { status: "busy" };

  postingGuilds.add(guild.id);
  try {
    let posted = 0;
    const candidates = limit > 0 ? (await postCandidates(settings)).slice(0, limit) : [];
    for (const event of candidates) {
      try {
        await postEvent(guild, channel, settings, event);
        posted++;
      } catch (err) {
        logger.error({ err, guildId: guild.id, eventId: event.id }, "failed to post event");
      }
    }
    return { status: "posted", posted };
  } finally {
    postingGuilds.delete(guild.id);
  }
}

/** Post anything new above threshold to every configured guild, respecting maxPostsPerDay. */
export async function postNewEvents(client: Client): Promise<number> {
  const guilds = await prisma.guildSettings.findMany({ where: { eventsChannelId: { not: null } } });
  let total = 0;

  for (const settings of guilds) {
    const postedToday = await prisma.post.count({ where: { guildId: settings.guildId, postedAt: { gte: chicagoMidnight(chicagoDay(new Date())) } } });
    const budget = settings.maxPostsPerDay - postedToday;
    if (budget <= 0) continue;

    const result = await postToGuild(client, settings, budget);
    if (result.status === "posted") total += result.posted;
  }
  return total;
}

/** Re-render posted messages and scheduled events after an event changes or is cancelled. */
export async function syncPostsForEvents(client: Client, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const posts = await prisma.post.findMany({ where: { eventId: { in: eventIds } }, include: { event: true } });

  for (const post of posts) {
    const guild = client.guilds.cache.get(post.guildId);
    if (!guild) continue;
    try {
      const channel = await resolveTextChannel(client, post.channelId);
      const message = await channel?.messages.fetch(post.messageId).catch(() => null);
      if (message) {
        const counts = await rsvpCounts(post.eventId, post.guildId);
        await message.edit({ embeds: [eventEmbed(post.event, counts)], components: [rsvpButtons(post.event, counts)] });
      }
      if (post.scheduledEventId) await syncScheduledEvent(guild, post.scheduledEventId, post.event);
      if (post.threadId && post.event.cancelled) {
        const thread = await client.channels.fetch(post.threadId).catch(() => null);
        if (thread?.isThread()) await thread.send("❌ Heads up: this event looks like it's been **cancelled**.");
      }
      await prisma.post.update({ where: { id: post.id }, data: { syncedAt: new Date() } });
    } catch (err) {
      logger.warn({ err, postId: post.id }, "failed to sync post");
    }
  }
}
