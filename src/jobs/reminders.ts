import type { Client } from "discord.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { resolveTextChannel } from "../discord/posting.js";
import { whenText } from "../discord/embeds.js";
import { chicagoHour } from "../lib/time.js";

const HOUR = 3600_000;
const NUDGE_MIN_RSVPS = 3;
/** Mentions per message; Discord caps content at 2000 chars. */
const MENTION_CHUNK = 50;

async function sendToThreadOrChannel(client: Client, post: { threadId: string | null; channelId: string }, content: string): Promise<void> {
  if (post.threadId) {
    const thread = await client.channels.fetch(post.threadId).catch(() => null);
    if (thread?.isThread()) {
      if (thread.archived) await thread.setArchived(false).catch(() => undefined);
      await thread.send({ content, allowedMentions: { parse: ["users"] } });
      return;
    }
  }
  const channel = await resolveTextChannel(client, post.channelId);
  await channel?.send({ content, allowedMentions: { parse: ["users"] } });
}

/** Don't ping people overnight (Chicago). */
export function isQuietHours(now: Date): boolean {
  const hour = chicagoHour(now);
  return hour < 9 || hour >= 21;
}

/** Hourly: day-before pings to Going, and a three-days-out nudge when a few people are in. */
export async function remindersJob(client: Client, now = new Date()): Promise<void> {
  if (isQuietHours(now)) return;
  const dayBefore = await prisma.post.findMany({
    where: {
      reminderSentAt: null,
      event: { cancelled: false, startsAt: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } },
    },
    include: { event: { include: { rsvps: { where: { status: "GOING" } } } } },
  });

  for (const post of dayBefore) {
    const going = post.event.rsvps.filter((r) => r.guildId === post.guildId).map((r) => `<@${r.userId}>`);
    try {
      if (going.length) {
        for (let i = 0; i < going.length; i += MENTION_CHUNK) {
          const mentions = going.slice(i, i + MENTION_CHUNK).join(" ");
          const head = i === 0 ? `⏰ **${post.event.title}** is ${whenText(post.event)}! Still need a ride? Sort it out here.\n` : "";
          await sendToThreadOrChannel(client, post, `${head}${mentions}`);
        }
      }
      await prisma.post.update({ where: { id: post.id }, data: { reminderSentAt: now } });
    } catch (err) {
      logger.warn({ err, postId: post.id }, "failed to send day-before reminder");
    }
  }

  const nudges = await prisma.post.findMany({
    where: {
      nudgeSentAt: null,
      threadId: { not: null },
      event: { cancelled: false, startsAt: { gt: new Date(now.getTime() + 24 * HOUR), lte: new Date(now.getTime() + 72 * HOUR) } },
    },
    include: { event: { include: { rsvps: { where: { status: { in: ["GOING", "INTERESTED"] } } } } } },
  });

  for (const post of nudges) {
    const rsvps = post.event.rsvps.filter((r) => r.guildId === post.guildId);
    if (rsvps.length < NUDGE_MIN_RSVPS) continue;
    const goingCount = rsvps.filter((r) => r.status === "GOING").length;
    const interestedCount = rsvps.length - goingCount;
    try {
      await sendToThreadOrChannel(
        client,
        post,
        `👀 ${goingCount} going and ${interestedCount} interested for **${post.event.title}** (${whenText(post.event)}). ` +
          `Pick a meetup spot and who's driving. Interested folks: now's the time to commit!`,
      );
      await prisma.post.update({ where: { id: post.id }, data: { nudgeSentAt: now } });
    } catch (err) {
      logger.warn({ err, postId: post.id }, "failed to send nudge");
    }
  }
}
