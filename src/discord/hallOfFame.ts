import { ButtonStyle, ChannelType, ComponentType, type MessageReaction, type PartialMessageReaction, type TextChannel } from "discord.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { logger } from "../logger.js";

export const HOF_CHANNEL_NAME = "hall-of-fame";
export const HOF_EMOJI = "⭐";
export const HOF_THRESHOLD = 7;

/**
 * When a message reaches HOF_THRESHOLD ⭐ reactions, forward it to #hall-of-fame (once).
 * Forwarding copies the message server-side, so we don't need the privileged Message Content intent.
 */
export async function handleStarReaction(reaction: MessageReaction | PartialMessageReaction): Promise<void> {
  if (reaction.emoji.name !== HOF_EMOJI) return;
  if (reaction.partial) reaction = await reaction.fetch();
  if (reaction.count < HOF_THRESHOLD) return;

  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  if (!message.inGuild()) return;

  const hof = message.guild.channels.cache.find(
    (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === HOF_CHANNEL_NAME,
  );
  if (!hof || message.channelId === hof.id) return;
  // Don't leak NSFW channel content into a SFW hall of fame.
  if ("nsfw" in message.channel && message.channel.nsfw && !hof.nsfw) return;

  // Claim the message first so two near-simultaneous stars can't post it twice.
  try {
    await prisma.hallOfFameEntry.create({ data: { messageId: message.id, guildId: message.guildId, channelId: message.channelId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return; // already in the hall
    throw err;
  }

  try {
    await hof.send({
      content: `${HOF_EMOJI} **${reaction.count}** · ${message.author} in ${message.channel}`,
      allowedMentions: { parse: [] },
      components: [
        { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Jump to message", url: message.url }] },
      ],
    });
    const forwarded = await message.forward(hof);
    await prisma.hallOfFameEntry.update({ where: { messageId: message.id }, data: { hofMessageId: forwarded.id } });
    logger.info({ guildId: message.guildId, messageId: message.id }, "added to hall of fame");
  } catch (err) {
    // Release the claim so the next star can retry (e.g. after fixing channel permissions).
    await prisma.hallOfFameEntry.delete({ where: { messageId: message.id } }).catch(() => undefined);
    throw err;
  }
}
