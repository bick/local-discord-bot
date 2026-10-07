import type { Client } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

/** Send an operational alert to the private #bot-logs channel, if configured. Never throws. */
export async function alert(client: Client, message: string): Promise<void> {
  const channelId = config().BOT_LOG_CHANNEL_ID;
  if (!channelId || !client.isReady()) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isSendable()) await channel.send({ content: `⚠️ ${message}`.slice(0, 2000), allowedMentions: { parse: [] } });
  } catch (err) {
    logger.warn({ err }, "failed to send alert");
  }
}
