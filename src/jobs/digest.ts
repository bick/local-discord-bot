import type { Client } from "discord.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { weekendWindow } from "../lib/time.js";
import { eventListEmbed } from "../discord/embeds.js";
import { resolveTextChannel } from "../discord/posting.js";
import { upcomingBigEvents } from "../discord/queries.js";

const DIGEST_SIZE = 5;
/** The digest is a roundup, so it dips a little below the auto-post bar. */
const DIGEST_SCORE_SLACK = 15;

/** Thursday evening: "This weekend in DFW" with the top 5 events. */
export async function digestJob(client: Client, now = new Date()): Promise<void> {
  const { from, to } = weekendWindow(now);
  const guilds = await prisma.guildSettings.findMany({ where: { digestEnabled: true, eventsChannelId: { not: null } } });

  for (const settings of guilds) {
    const channel = await resolveTextChannel(client, settings.eventsChannelId!);
    if (!channel) continue;
    const pool = await upcomingBigEvents({ from, to, minScore: Math.max(0, settings.minBigScore - DIGEST_SCORE_SLACK), take: 50 });
    const filtered = settings.categories.length ? pool.filter((e) => settings.categories.includes(e.category)) : pool;
    const top = [...filtered].sort((a, b) => b.bigScore - a.bigScore).slice(0, DIGEST_SIZE).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    if (top.length === 0) continue;

    // Link to the original post where there is one so RSVPs land in one place.
    const posts = await prisma.post.findMany({ where: { guildId: settings.guildId, eventId: { in: top.map((e) => e.id) } } });
    const postLinks = posts.map((p) => {
      const ev = top.find((e) => e.id === p.eventId)!;
      return `• ${ev.title}: https://discord.com/channels/${p.guildId}/${p.channelId}/${p.messageId}`;
    });

    try {
      await channel.send({
        content: "🤠 **This weekend in DFW.** Who's in? Hit Going on a post and grab a carpool in its thread.",
        embeds: [
          eventListEmbed("🌟 This weekend in DFW", top, {
            description: postLinks.length ? `RSVP on the posts:\n${postLinks.join("\n")}` : undefined,
          }),
        ],
      });
    } catch (err) {
      logger.warn({ err, guildId: settings.guildId }, "failed to send digest");
    }
  }
}
