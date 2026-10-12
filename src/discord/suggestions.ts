import { ChannelType, type Message } from "discord.js";

export const SUGGESTIONS_CHANNEL_NAME = "server-suggestions";
export const VOTE_EMOJIS = ["👍", "👎"] as const;

/**
 * Seed 👍/👎 on every new suggestion so people can vote with one click.
 * Works whether #server-suggestions is a text channel (each top-level message) or a forum (each post).
 */
export async function handleSuggestion(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || message.system) return;
  const ch = message.channel;
  const isSuggestion = ch.isThread()
    ? ch.parent?.type === ChannelType.GuildForum && ch.parent.name === SUGGESTIONS_CHANNEL_NAME && message.id === ch.id // the post itself, not replies
    : ch.name === SUGGESTIONS_CHANNEL_NAME && !message.reference; // skip replies so discussion doesn't get votes
  if (!isSuggestion) return;
  for (const emoji of VOTE_EMOJIS) await message.react(emoji); // in order, so 👍 is always first
}
